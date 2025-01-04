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
    const dockerContainer = this.docker.getContainer(this.container.getId());

    const execCommand = ['sh', '-c', commands.join('; ')];
    this.execCommands = this.execCommands || [];
    this.execCommands.push({ execCommand });
    const exec = await dockerContainer.exec({
      Cmd: execCommand,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
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
        const command = this.execCommands.find(cmd => cmd.execCommand === execCommand);
        this.execCommands = this.execCommands.filter(cmd => cmd.execCommand !== execCommand);
        if (command.isKilled) {
          return;
        }
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
        const commandIndex = this.execCommands.findIndex((e) => arg === e.execCommand.join(' '));
        if (this.execCommands[commandIndex]) {
          const pid = process[1];
          // Execute the kill command inside the container
          const exec = await dockerContainer.exec({
            Cmd: ['kill', '-9', pid], // You can use `-TERM` for graceful shutdown, or `-9` for forceful
            AttachStdout: true,
            AttachStderr: true
          });
          this.execCommands[commandIndex].isKilled = true;

          // Start the execution
          await exec.start({ hijack: true, stdin: false });
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
