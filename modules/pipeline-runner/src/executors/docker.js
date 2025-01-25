const { GenericContainer } = require('testcontainers');
const Docker = require('dockerode');
const slash = require('slash');

class DockerExecutor {
  constructor () {
    this.docker = new Docker();
    this.container = null;
    this.subcontainers = new Map();
  }

  async isContainerRunning (name) {
    const containers = await this.docker.listContainers({ all: false });
    return containers.some((container) => container.Names.includes(`/${name}`));
  }

  async start ({ image, workingDir, name }) {
    this.containerName = name;
    let randString = '';
    if (this.isContainerRunning(name)) {
      randString = '_' + Math.random().toString().substring(2, 15);
    }
    this.container = await new GenericContainer(image)
      .withName(this.createValidContainerName(name) + randString)
      .withWorkingDir(workingDir)
      .withStartupTimeout(120000)
      .withPrivilegedMode(true)
      .withCommand(['sh', '-c', "echo 'Container is ready' && tail -f /dev/null"])
      .start();

    return this.container;
  }

  async copyFiles (files) {
    for await (const file of files) {
      await this.container.copyFilesToContainer([{
        source: slash(file.source),
        target: slash(file.target),
      }]);
    }
  }

  async deleteFiles (files) {
    const dockerContainer = this.docker.getContainer(this.container.getId());
    await this._waitForContainerToUnpause(dockerContainer);
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
    const { clone, env, secrets, name } = opts;
    this.isKilled = false;
    let subcontainer = null;
    if (clone) {
      subcontainer = await this._cloneContainer({ name });
      if (subcontainer === null) {
        const err = new Error();
        err.isKilled = true;
        throw err;
      }
    }
    const dockerContainer = clone ?
      subcontainer.container.container :
      this.docker.getContainer(this.container.getId());

    const Env = Object.entries(env || {}).map(([key, value]) => `${key}=${value}`);

    const execCommand = ['sh', '-c', commands.join('; ')];

    await this._waitForContainerToUnpause(dockerContainer);
    const exec = await dockerContainer.exec({
      Cmd: execCommand,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    const secretValues = Object.values(secrets);

    stream.on('data', (chunk) => {
      // Log the chunk to the console
      let filteredChunk = chunk.toString().replace(/[^ -~\n]/g, ''); // Allow only printable ASCII characters
      for (const secretValue of secretValues) {
        filteredChunk = filteredChunk.replace(new RegExp(secretValue, 'g'), '*'.repeat(secretValue.length));
      }
      fsStream.write(filteredChunk);
    });

    return new Promise((resolve, reject) => {
      stream.on('end', async () => {
        if (!subcontainer && this.isKilled) {
          this.isKilled = null;
          reject({ isKilled: true });
          return;
        }

        // if it's cloned container and the container was already removed,
        // return that this "isKilled"
        if (subcontainer) {
          const isKilled = !this.subcontainers.has(subcontainer.id);
          if (isKilled) {
            reject({ isKilled: true });
            return;
          }
        }
        const execInspect = await exec.inspect();
        const exitCode = execInspect.ExitCode;
        if (exitCode === 0) {resolve(exitCode);} else {resolve(exitCode);}
        if (subcontainer) {
          this._destroyContainer(subcontainer);
        }
      });
    });
  }

  async runService () {

  }

  // TODO: allow it to just kill one job here with arg { name }
  async stopExec (name) {
    // if no name provided, stop everything
    if (!name) {
      await Promise.all([
        this.stopMainExec(),
        this._stopClonedContainers(),
      ]);
    }

    // if it's a subcontainer job, stop that
    const subcontainer = this._findSubcontainerByName(name);
    if (subcontainer) {
      this._destroyContainer(subcontainer);
      return null;
    }

    // TODO: add this.name attribute and check they match
    this.stopMainExec();
  }

  async stopMainExec () {

    // TODO: instead of a general "this.isKilled", this should be
    // a set containing a list of all the killed job names
    this.isKilled = true;
    const dockerContainer = this.docker.getContainer(this.container.getId());

    // TODO: parallelize the stopping of the main process and stopping of cloned containers

    // kill the "sh" process which is what runs all processes
    await this._waitForContainerToUnpause(dockerContainer);
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
    return await Promise.all([
      this.container && this.container.stop(),
      this._stopClonedContainers(),
    ]);
  }

  async _stopClonedContainers () {
    for await (const [, subcontainer] of this.subcontainers || []) {
      await this._destroyContainer(subcontainer);
    }
  }

  createValidContainerName (name) {
    return name.replace(/\s+/g, '_') // Replace whitespace with underscores
               .replace(/[^a-zA-Z0-9_.-]/g, ''); // Remove invalid characters
  }

  async _cloneContainer ({ name }) {
    // TODO: make it so that it doesn't copy the image for every single clone
    // only do it for one and re-use it for all of the clones (maybe this isn't necessary?)
    const dockerContainer = this.docker.getContainer(this.container.getId());

    const subcontainer = new Subcontainer();

    // Step 1: Create a new image from the existing container
    const randString = Math.random().toString().substring(2, 10);
    subcontainer.setId(randString);
    this.subcontainers.set(randString, subcontainer);

    const imageName = `cloned-image-${randString}`; // Generate a random image name
    await dockerContainer.commit({
      repo: imageName,
      tag: 'latest',
    });
    subcontainer.setImage(imageName);

    if (!this.subcontainers.has(subcontainer.id)) {
      this.docker.getImage(imageName).remove({ force: true });
      return null;
    }

    // Step 2: Start a new container from the created image
    const newContainer = await new GenericContainer(imageName)
      .withName(this.createValidContainerName(this.containerName + '_' + name + '_' + randString))
      .withStartupTimeout(120000)
      .withPrivilegedMode(true)
      .start();

    subcontainer.setContainer(newContainer);

    if (!this.subcontainers.has(subcontainer.id)) {
      await Promise.allSettled([
        this.docker.getImage(imageName).remove({ force: true }),
        newContainer.container.remove({ force: true }),
      ]);
      return null;
    }

    return subcontainer;
  }

  _findSubcontainerByName (name) {
    let subcontainerToDestroy = null;
    for (const subcontainer of this.subcontainers) {
      if (subcontainer.name === name) {
        subcontainerToDestroy = subcontainer;
      }
    }
    return subcontainerToDestroy;
  }

  async _destroyContainer (subcontainer) {
    // Remove the entry from subcontainers
    this.subcontainers.delete(subcontainer.id);
    return await Promise.allSettled([
      subcontainer?.container?.container?.remove({ force: true }),
      subcontainer?.image && this.docker.getImage(subcontainer.image).remove({ force: true })
    ]);
  }

  async _waitForContainerToUnpause (container) {
    let isPaused = true;
    while (isPaused) {
      const containerInfo = await container.inspect();
      isPaused = containerInfo.State.Paused;
      if (isPaused) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second before checking again
      }
    }
  }
}

class Subcontainer {
  setName (name) { this.name = name; }
  setContainer (container) { this.container = container; }
  setImage (image) { this.image = image; }
  setId (id) { this.id = id; }
}

module.exports = DockerExecutor;
