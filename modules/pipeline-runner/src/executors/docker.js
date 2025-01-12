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
      // TODO: redact any secrets and any suspected PII here
      // TODO: filter out illegal characters
      const filteredChunk = chunk.toString().replace(/[^ -~\n]/g, ''); // Allow only printable ASCII characters
      fsStream.write(filteredChunk);
    });

    return new Promise((resolve, reject) => {
      stream.on('end', async () => {
        if (this.isKilled) {
          this.isKilled = null;
          reject({ isKilled: true });
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

    // kill the "sh" process which is what runs all processes
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
  }

  async stop () {
    if (this.container) {
      await this.container.stop();
    }
  }
}

module.exports = DockerExecutor;
