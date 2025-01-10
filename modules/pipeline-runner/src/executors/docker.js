const { GenericContainer } = require('testcontainers');
const Docker = require('dockerode');
const slash = require('slash');

class DockerExecutor {
  constructor () {
    this.docker = new Docker();
    this.container = null;
  }

  async start (image, workingDir) {
    this.container = await new GenericContainer(image)
      .withWorkingDir(workingDir)
      .withStartupTimeout(120000)
      .withPrivilegedMode(true)
      .withCommand(['sh', '-c', "echo 'Container is ready' && tail -f /dev/null"])
      .start();

    console.log('Container is ready. Starting pipeline execution.');
    return this.container;
  }

  async copyFiles (files) {
    for (const file of files) {
      await this.container.copyFilesToContainer([{
        source: slash(file.source),
        target: slash(file.target),
      }]);
    }
  }

  async deleteFiles (files) {
    const dockerContainer = this.docker.getContainer(this.container.getId());
    for (const file of files) {
      const exec = await dockerContainer.exec({
        Cmd: ['rm', slash(file.target)], // Command to delete the file
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ hijack: true, stdin: false });
      await new Promise((resolve, reject) => {
        stream.on('end', async () => {
          const execInspect = await exec.inspect();
          const exitCode = execInspect.ExitCode;
          if (exitCode === 0) { resolve(exitCode); } else { reject(exitCode); }
        });
      });
    }
  }

  // TODO: make it clone container if it is a sibling container
  async run (commands, fsStream) {
    this.isKilled = false;
    const dockerContainer = this.docker.getContainer(this.container.getId());

    const execCommand = ['sh', '-c', commands.join('; ')];
    const exec = await dockerContainer.exec({
      Cmd: execCommand,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    stream.on('data', (chunk) => {
      // Log the chunk to the console
      // TODO: Only log this if verbosity was set + change all console logs to use Winston
      console.log('Received chunk:', chunk.toString()); // Convert to string if necessary
      // TODO: filter out illegal characters
      fsStream.write(chunk);
    });

    return new Promise((resolve, reject) => {
      stream.on('end', async () => {
        if (this.isKilled) {
          this.isKilled = null;
          resolve();
          return;
        }
        const execInspect = await exec.inspect();
        const exitCode = execInspect.ExitCode;
        if (exitCode === 0) {resolve(exitCode);} else {reject(exitCode);}
      });
    });
  }

  async stopExec () {
    this.isKilled = true;
    const dockerContainer = this.docker.getContainer(this.container.getId());
    const exec = await dockerContainer.exec({
      Cmd: ['pkill', 'sh'], // You can use `-TERM` for graceful shutdown, or `-9` for forceful
      AttachStdout: true,
      AttachStderr: true
    });

    // Start the execution
    const killStream = await exec.start({ hijack: true, stdin: false });
    await new Promise((resolve) => {
      killStream.on('end', function () {
        resolve();
      });
      killStream.on('data', () => {
        // for some reason, 'end' is only triggered when this event
        // is set
      });
    });
    console.log('done stopping everything');
  }

  async stop () {
    if (this.container) {
      await this.container.stop();
    }
  }
}

module.exports = DockerExecutor;
