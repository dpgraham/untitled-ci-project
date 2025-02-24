const express = require('express');
const portfinder = require('portfinder');
const path = require('path');
const pipelineStore = require('./pipeline.store');
const { Tail } = require('tail');
const fs = require('fs');
const { promises: fsPromises } = fs;

const app = express();

/** TODO: bugs
 * - some of the logs still can't be read
 * - invalidating a pipeline (by saving .pipeline.js) causes logs to empty and nothing shows up
 */

async function run () {
  const port = await portfinder.getPortPromise();

  return await new Promise((resolve) => {
    app.get('/status', (req, res) => {
      res.json({ message: 'Server is running' });
    });

    // Serve static files from a directory
    // TODO: have a dev mode where it proxies the dev server
    const staticAssets = path.join(__dirname, '..', 'dist');
    app.use(express.static(staticAssets));

    // New endpoint for Server-Sent Events
    app.get('/events', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const onStateChange = (state) => {
        sendEvent({ message: 'state', state });
      };

      let sendEvent = (data) => {
        if (res.writableEnded) {
          pipelineStore.removeStateChangeHandler(onStateChange);
          return;
        }
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      pipelineStore.handleStateChange(onStateChange);
      sendEvent({ message: 'state', state: pipelineStore.getState()});

      // ping the client to keep this alive
      const intervalId = setInterval(() => {
        sendEvent({ message: 'ping', timestamp: new Date() });
      }, 1000);

      // Clean up when the connection is closed
      req.on('close', () => {
        clearInterval(intervalId);
        pipelineStore.removeStateChangeHandler(onStateChange);
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

      let tail;

      const sendEvent = (data) => {
        if (res.writableEnded) {
          tail?.unwatch();
          return;
        }
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      const { logFilePath } = selectedJob || {};

      // ping the client to keep this alive
      const intervalId = setInterval(() => {
        sendEvent({ message: 'ping', timestamp: new Date() });
      }, 1000);

      // Clean up when the connection is closed
      req.on('close', () => {
        clearInterval(intervalId);
        tail?.unwatch();
        res.end();
      });

      // Set up SSE response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Stream the log file
      const streamLogFile = async () => {
        try {
          // Get the file size and read the last 10 KB
          const stats = await fsPromises.stat(logFilePath);
          const start = Math.max(0, stats.size - 10 * 1024); // Start position for the last 100 KB
          const readStream = fs.createReadStream(logFilePath, { encoding: 'utf8', start, end: stats.size }); // Limit to last 100 KB
          tail = new Tail(logFilePath, { follow: true });

          // when contents of the file change, send thode changes to the stream
          const MAX_LINE_LENGTH = 1000;
          tail.on('line', function (line) {
            sendEvent({ message: 'log', data: line.substr(0, MAX_LINE_LENGTH) });
          });

          tail.on('error', function () {
            res.end();
          });

          readStream.on('data', (chunk) => {
            sendEvent({ message: 'log', data: chunk });
          });

          readStream.on('error', (/* err */) => {
            res.status(500).send('Error reading log file');
          });

        } catch (err) {
          res.status(500).send('Error getting log file stats');
        }
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
