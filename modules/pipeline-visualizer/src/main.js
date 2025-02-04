const express = require('express');
const app = express();
const portfinder = require('portfinder');

async function run () {
  const port = await portfinder.getPortPromise();
  return await new Promise((resolve) => {
    app.get('/status', (req, res) => {
      res.json({ message: 'Server is running' });
    });

    let sendEvent;

    // New endpoint for Server-Sent Events
    app.get('/events', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // ping the client to keep this alive
      const intervalId = setInterval(() => {
        sendEvent({ message: 'ping', timestamp: new Date() });
      }, 1000);

      // Clean up when the connection is closed
      req.on('close', () => {
        clearInterval(intervalId);
        res.end();
      });

      resolve();
    });

    // Start the server
    const server = app.listen(port, () => {
      /* eslint-disable */
      console.log(`Server is running on port ${port}`);
    });

    async function closeServer () {
      await server.close();
    }

    return { port, closeServer, sendEvent };
  });
}

if (require.main === module) {
  run().then(() => console.log('it is ready!!!'));
}

module.exports = { run };