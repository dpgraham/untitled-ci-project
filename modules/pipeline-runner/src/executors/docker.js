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

  async run (commands, fsStream, opts) {
    const { clone } = opts;
    this.isKilled = false;
    let clonedContainer = null;
    if (clone) {
      clonedContainer = await this._cloneContainer();
    }
    const dockerContainer = clone ?
      clonedContainer.container :
      this.docker.getContainer(this.container.getId());

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
        if (!clonedContainer && this.isKilled) {
          this.isKilled = null;
          reject({ isKilled: true });
          return;
        }

        // if it's cloned container and the container was already removed,
        // return that this "isKilled"
        if (clonedContainer) {
          const isKilled = !this.clonedContainers.find(({ container }) =>
            container.id === dockerContainer.id
          );
          if (isKilled) {
            reject({ isKilled: true });
            return;
          }
        }
        const execInspect = await exec.inspect();
        const exitCode = execInspect.ExitCode;
        if (exitCode === 0) {resolve(exitCode);} else {reject(exitCode);}
        if (clonedContainer) {
          this._destroyContainer(clonedContainer);
        }
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

    // Kill any cloned containers
    this._stopClonedContainers();
  }

  async stop () {
    return await Promise.all([
      this.container && this.container.stop(),
      this._stopClonedContainers(),
    ]);
  }

  async _stopClonedContainers () {
    for await (const clonedContainer of this.clonedContainers || []) {
      await this._destroyContainer(clonedContainer);
    }
  }

  async _cloneContainer () {
    // TODO: when creating containers, give them names that indicate that they're
    // being run from this application
    const dockerContainer = this.docker.getContainer(this.container.getId());

    // Step 1: Create a new image from the existing container
    const imageName = `cloned-image-${Math.random().toString(36).substring(2, 15)}`; // Generate a random image name
    await dockerContainer.commit({
      repo: imageName,
      tag: 'latest',
    });

    // Step 2: Start a new container from the created image
    const newContainer = await new GenericContainer(imageName)
      .withStartupTimeout(120000)
      .withPrivilegedMode(true)
      .start();

    const output = { container: newContainer.container, image: imageName };
    this.clonedContainers = this.clonedContainers || [];
    this.clonedContainers.push(output);

    return { container: newContainer.container, image: imageName };
  }

  async _destroyContainer ({ container, image }) {
    // Remove the entry from clonedContainers
    this.clonedContainers = this.clonedContainers.filter(
      (cloned) => cloned.container.id !== container.id
    );
    return await Promise.allSettled([
      container.remove({ force: true }),
      this.docker.getImage(image).remove({ force: true })
    ]);
  }
}

module.exports = DockerExecutor;
