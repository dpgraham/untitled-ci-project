const express = require('express');
const portfinder = require('portfinder');
const path = require('path');
const pipelineStore = require('./pipeline.store');
const { Tail } = require('tail');
const fs = require('fs');

const app = express();

async function run () {
  const port = await portfinder.getPortPromise();

  return await new Promise((resolve) => {
    app.get('/status', (req, res) => {
      res.json({ message: 'Server is running' });
    });

    // Serve static files from a directory
    // TODO: have a dev mode where it proxies the dev server
    const staticAssets = path.join(__dirname, '..', '..', 'pipeline-visualizer', 'dist');
    app.use(express.static(staticAssets));

    // New endpoint for Server-Sent Events
    app.get('/events', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      pipelineStore.handleStateChange((state) => {
        sendEvent({ message: 'state', state });
      });
      sendEvent({ message: 'state', state: pipelineStore.getState()});

      // TODO: 1 send a message to the UI page when it's dead or set the status to "aborted"

      // ping the client to keep this alive
      const intervalId = setInterval(() => {
        sendEvent({ message: 'ping', timestamp: new Date() });
      }, 1000);

      // Clean up when the connection is closed
      req.on('close', () => {
        clearInterval(intervalId);
        res.end();
      });

      resolve({ port, closeServer });
    });

    app.get('/logs/:jobName', (req, res) => {
      const jobName = req.params.jobName;
      const jobs = pipelineStore.getState().jobs;
      let selectedJob;
      for (const job of jobs) {
        if (job.name === jobName) {
          selectedJob = job;
          break;
        }
      }
      const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      const { logfilePath } = selectedJob || {};

      // ping the client to keep this alive
      setInterval(() => {
        sendEvent({ message: 'ping', timestamp: new Date() });
      }, 1000);

      // Set up SSE response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Stream the log file
      const streamLogFile = () => {
        if (!logfilePath) {
          res.status(404).end();
        }
        const tail = new Tail(logfilePath);
        // Read the entire contents of the log file and send it to the client
        fs.readFile(logfilePath, 'utf8', (err, data) => {
          // TODO: 0 limit how much of the log file is read so that it doesn't
          // overload the browser's memory
          if (err) {
            res.status(500).send('Error reading log file');
            return;
          }
          sendEvent({ message: 'log', data }); // Send the entire contents of the log file
        });

        // when contents of the file change, send those changes to the stream
        tail.on('line', function (line) {
          sendEvent({ message: 'log', data: line });
        });
        tail.on('error', function () {
          res.end();
        });
      };

      streamLogFile();
    });

    // Start the server
    const server = app.listen(port, () => {
      /* eslint-disable */
      console.log(`Server is running on port ${port}`);
    });

    async function closeServer () {
      await server.close();
    }

    // Open the browser at the specified port
    import('open').then(({ default: open }) => {
      open(`http://localhost:${port}`);
    });
  });
}

if (require.main === module) {
  run();
}

module.exports = { run };
