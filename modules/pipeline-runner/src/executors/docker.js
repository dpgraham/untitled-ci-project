const { GenericContainer } = require('testcontainers');
const Docker = require("dockerode");
const path = require('path');

class DockerExecutor {
  constructor() {
    this.docker = new Docker();
    this.container = null;
  }

  async start(image, workingDir) {
    this.container = await new GenericContainer(image)
      .withWorkingDir(workingDir)
      .withStartupTimeout(120000)
      .withPrivilegedMode(true)
      .withCommand(["sh", "-c", "echo 'Container is ready' && tail -f /dev/null"])
      .start();
    
    console.log('Container is ready. Starting pipeline execution.');
    return this.container;
  }

  async copyFiles(files, destPath) {
    for (const file of files) {
      await this.container.copyFilesToContainer([{
        source: file.source,
        target: file.target,
      }]);
    }
  }

  async runStep(step) {
    console.log(`Executing step: ${step.command}`);
    const dockerContainer = this.docker.getContainer(this.container.getId());

    const exec = await dockerContainer.exec({
      Cmd: ["sh", "-c", step.command],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    this.docker.modem.demuxStream(stream, process.stdout, process.stderr);
    
    return new Promise((resolve, reject) => {
      stream.on("end", async () => {
        const execInspect = await exec.inspect();
        const exitCode = execInspect.ExitCode;
        if (exitCode === 0) resolve(exitCode);
        else reject(exitCode);
      });
    });
  }

  async stop() {
    if (this.container) {
      await this.container.stop();
    }
  }
}

module.exports = DockerExecutor;

