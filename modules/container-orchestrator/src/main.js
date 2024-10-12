import Docker from 'dockerode';

/**
 * runs a Docker container, leaves it running and returns a reference to it
 * @param {*} param0 
 */
async function runContainer ({docker, containerOpts}) {
  // TODO: Add functionality to pull the "image" first
  const container = await docker.createContainer({
    Image: 'node:20',
    AttachStdin: false,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Cmd: ['/bin/sh'],
    OpenStdin: false,
    StdinOnce: false
  });
  await container.start();
}

// Create a function to execute the command
async function executeCommand(container, command) {
    return new Promise((resolve, reject) => {
      container.exec({
        Cmd: command,
        AttachStdout: true,
        AttachStderr: true,
      }, (err, exec) => {
        if (err) return reject(err);
  
        exec.start((err, stream) => {
          if (err) return reject(err);
  
          let output = '';
          stream.on('data', chunk => {
            output += chunk.toString('utf8');
          });
  
          stream.on('end', () => {
            console.log('@@@@output', output);
            resolve(output);
          });
        });
      });
    });
  }

export { runContainer, executeCommand };
