const { GenericContainer } = require('testcontainers');
const Docker = require('dockerode');
const path = require('path');

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
        source: file.source,
        target: file.target,
      }]);
    }
  }

  async runStep (step, fsStream) {
    console.log(`Executing step: ${step.command}`);
    const dockerContainer = this.docker.getContainer(this.container.getId());
    const execCommand = ['sh', '-c', step.command];
    this.execCommand = execCommand;

    this.exec = await dockerContainer.exec({
      Cmd: execCommand,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });

    const exec = this.exec;

    const stream = await exec.start({ hijack: true, stdin: false });

    stream.on('data', (chunk) => {
      // Log the chunk to the console
      console.log('Received chunk:', chunk.toString()); // Convert to string if necessary
      fsStream.write(chunk);
  });

    return new Promise((resolve, reject) => {
      stream.on('end', async () => {
        this.execCommand = null;
        const execInspect = await exec.inspect();
        const exitCode = execInspect.ExitCode;
        if (exitCode === 0) {resolve(exitCode);} else {reject(exitCode);}
      });
    });
  }

  async stopExec () {
    const dockerContainer = this.docker.getContainer(this.container.getId());
    const { Processes: processes } = await dockerContainer.top();
    for (const process of processes) {
      for (let i = 0; i < process.length; i++) {
        const arg = process[i];

        if (arg === this.execCommand?.join(' ')) {
          const pid = process[1];
          // Execute the kill command inside the container
          const exec = await dockerContainer.exec({
            Cmd: ['kill', '-9', pid], // You can use `-TERM` for graceful shutdown, or `-9` for forceful
            AttachStdout: true,
            AttachStderr: true
          });

          // Start the execution
          const stream = await exec.start();
        }
      }
    }

  }

  async stop () {
    if (this.container) {
      await this.container.stop();
    }
  }
}

module.exports = DockerExecutor;
