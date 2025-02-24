const { GenericContainer } = require('testcontainers');
const Docker = require('dockerode');
const slash = require('slash');
const fs = require('fs');
const { getLogger } = require('../logger');
const path = require('path');
const tar = require('tar-stream');

const env = process.env;

const logger = getLogger();

class DockerExecutor {
  constructor () {
    let dockerOpts = {
      host: env.DOCKER_HOST,
      port: env.DOCKER_PORT,
      socketPath: env.DOCKER_SOCKET_PATH,
      username: env.DOCKER_USERNAME,
      headers: env.DOCKER_HEADERS ? JSON.parse(env.DOCKER_HEADERS || '{}') : undefined,
      ca: env.DOCKER_CA ? env.DOCKER_CA.split(',') : undefined,
      cert: env.DOCKER_CERT ? env.DOCKER_CERT.split(',') : undefined,
      key: env.DOCKER_KEY ? env.DOCKER_KEY.split(',') : undefined,
      protocol: env.DOCKER_PROTOCOL,
      timeout: env.DOCKER_TIMEOUT ? parseInt(env.DOCKER_TIMEOUT, 10) : undefined,
      version: env.DOCKER_VERSION,
      sshAuthAgent: env.DOCKER_SSH_AUTH_AGENT,
      sshOptions: env.DOCKER_SSH_OPTIONS ? JSON.parse(env.DOCKER_SSH_OPTIONS || '{}') : undefined,
    };

    // Remove undefined properties from dockerOpts
    Object.keys(dockerOpts).forEach((key) => {
      if (dockerOpts[key] === undefined) {
        delete dockerOpts[key];
      }
    });

    this.docker = new Docker(dockerOpts);
    this.testContainer = null;
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

    const outputDir = 'output-123e4567-e89b-12d3-a456-426614174000';
    const createOutputCommand = `mkdir -p ${outputDir}`;
    const imageName = typeof image === 'string' ? image : image.name;

    this.testContainer = await new GenericContainer(imageName)
      .withName(this._createValidContainerName(name) + randString)
      .withEnvironment({ CI_OUTPUT: `${outputDir}/outputs.log` })
      .withWorkingDir(workingDir)
      .withStartupTimeout(120000)
      .withPrivilegedMode()
      .withCommand(['sh', '-c', `echo 'Container is ready' && ${createOutputCommand} && tail -f /dev/null`])
      .start();
    logger.debug(`Started container. testContainer=${this.testContainer.getId()} jobName=${name}`);

    return this.testContainer;
  }

  async copyFiles (files) {
    for await (const file of files) {
      await this.testContainer.copyFilesToContainer([{
        source: slash(file.source),
        target: slash(file.target),
      }]);
    }
    logger.debug(`Copied files to container. testContainer=${this.testContainer.getId()}`);
    if (this.imageName) {
      const imageName = this.imageName;
      delete this.imageName;
      delete this.clonePromise;
      logger.debug(`Cleaning up cloned image. imageName=${imageName}`);
      await this.stopSubContainers(imageName);
      logger.debug(`Committing new cloned image. Done deleting imageName=${imageName}`);
      this.imageName = await this._commitClonedImage();
      logger.debug(`New cloned image. imageName=${this.imageName}`);
    }
  }

  async deleteFiles (files) {
    const dockerContainer = this.testContainer.container;
    for (const file of files) {
      logger.debug(`Deleting files from container. testContainer=${this.testContainer.getId()}`);
      const exec = await this.exec(dockerContainer, {
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

    // clone the main image again
    if (this.imageName) {
      const imageName = this.imageName;
      delete this.imageName;
      delete this.clonePromise;
      logger.debug(`Cleaning up cloned image. imageName=${imageName}`);
      await this.stopSubContainers(imageName);
      logger.debug(`Committing new cloned image. Done deleting imageName=${imageName}`);
      this.imageName = await this._commitClonedImage();
      logger.debug(`New cloned image. imageName=${this.imageName}`);
    }
  }

  /**
   * Stop all subcontainers and then delete the image that was used
   * to create any subcontainer clones
   */
  async stopSubContainers (clonedImageName) {
    let promises = [];
    for (const [, subcontainer] of this.subcontainers) {
      promises.push(this._destroyContainer(subcontainer));
    }
    await Promise.all(promises);
    if (clonedImageName) {
      logger.debug(`Deleting cloned image. imageName=${clonedImageName}`);
      const containers = await this.docker.listContainers({ all: true });
      const isImageInUse = containers.some((container) => container.Image === clonedImageName);
      if (isImageInUse) {
        logger.debug(`Not deleting image because it is already in use. imageName=${clonedImageName}`);
        return;
      }
      const images = await this.docker.listImages();
      const imageExists = images.some((image) => image.RepoTags && image.RepoTags.includes(clonedImageName));
      if (!imageExists) {
        logger.debug(`Image is already deleted. imageName=${clonedImageName}`);
        return;
      }

      await this.docker.getImage(clonedImageName).remove({ force: true });
    }
  }

  /**
   * Copy files from one container to another
   * @param {Dockerode.Container} sourceContainer
   * @param {string} sourcePath
   * @param {Dockerode.Container} destContainer
   * @param {string} destPath
   */
  async copyFilesBetweenContainers (sourceContainer, sourcePath, destContainer, destPath) {
    const archiveStream = await sourceContainer.getArchive({ path: sourcePath });
    const extract = tar.extract();
    const pack = tar.pack();

    extract.on('entry', (header, stream, next) => {
      // TODO: 2... investigate this mystery some day why it doesn't work and gives 404!
      // header.name = slash(path.relative(sourcePath, header.name));
      stream.pipe(pack.entry(header, next));
    });

    extract.on('finish', () => {
      pack.finalize();
    });

    archiveStream.pipe(extract);

    await destContainer.putArchive(pack, { path: destPath });

    // shameful hack... in destContainer, move the newly moved files
    // up 'n' levels so that we don't include the whole qualified path
    // (I resorted to this because header.name translation wasn't working, sorry)
    const dirLevels = sourcePath.split('/').map(() => '..').join('/');
    let mvExec = await this.exec(destContainer, {
      Cmd: ['sh', '-c', `mv -f ${destPath}/${sourcePath}/.[!.]* ${destPath}/${sourcePath}/${dirLevels}/`],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    await mvExec.start({ hijack: true, stdin: false });
    mvExec = await this.exec(destContainer, {
      Cmd: ['sh', '-c', `mv -f ${destPath}/${sourcePath}/* ${destPath}/${sourcePath}/${dirLevels}/`],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    await mvExec.start({ hijack: true, stdin: false });
  }

  async exec (container, ...args) {
    const state = await this._waitForContainerToUnpause(container);
    if (!state.Running) {
      const err = new Error('container is closed');
      err.isKilled = true;
      throw err;
    }
    try {
      const res = await container.exec(...args);
      return res;
    } catch (err) {
      // 409 status code means the container was stopped
      if (err.statusCode === 409) {
        err.isKilled = true;
      }
      throw err;
    }
  }

  async run (commands, fsStream, opts) {
    const { clone, env, secrets, name, image, copy = [], artifactsDirSrc, artifactsDirDest, workDir } = opts;
    this.runningJob = name;
    let subcontainer = null;
    if (clone || image) {
      if (!image) {
        this.imageName = await this._commitClonedImage();
      }
      subcontainer = await this._cloneContainer({ name, image, workDir });
      if (subcontainer === null) {
        const err = new Error();
        err.isKilled = true;
        throw err;
      }

      for await (const copyFiles of copy) {
        const { src, dest = '.' } = copyFiles;
        await this.copyFilesBetweenContainers(this.testContainer.container, src, subcontainer.testContainer.container, dest);
      }
    } else if (this.imageName) {
      const imageName = this.imageName;
      delete this.imageName;
      delete this.clonePromise;
      await this.docker.getImage(imageName).remove({ force: true });
    }

    const dockerContainer = clone ?
      subcontainer.testContainer.container :
      this.docker.getContainer(this.testContainer.getId());

    const execCommand = ['sh', '-c', commands.join('; ')];

    const Env = Object.entries(env || {}).map(([key, value]) => `${key}=${value}`);

    logger.debug(`Running command. execCommand='${execCommand}' containerId=${dockerContainer.id}`);
    const exec = await this.exec(dockerContainer, {
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
        filteredChunk = filteredChunk.replace(new RegExp(secretValue, 'g'), '*'.repeat((secretValue || '').length));
      }
      fsStream.write(filteredChunk);
      try {
        fs.fsyncSync(fsStream.fd);
      } catch (ign) { }
    });

    return new Promise((resolve, reject) => {
      stream.on('end', async () => {
        logger.debug(`Done running command. execCommand='${execCommand}' containerId=${dockerContainer.id}`);

        // if it's cloned container and the container was already removed,
        // return that this "isKilled"
        if (!subcontainer && !this.runningJob) {
          logger.debug(`Subcontainer was destroyed by main process. jobName=${name}`);
          reject({ isKilled: true });
          return;
        }
        if (subcontainer) {
          const isKilled = !this.subcontainers.has(subcontainer.id);
          if (isKilled) {
            logger.debug(`Subcontainer was removed by main process. jobName=${name}`);
            reject({ isKilled: true });
            return;
          }
        }

        // pull out the artifacts, if there are any
        if (artifactsDirSrc) {
          try {
            // console.log('yip'); // TODO: 0 -- bug -- uncomment and then recomment while job in progress, causes crash due to no container
            logger.debug(`Pulling artifacts. containerId=${dockerContainer.id} artifactsDirSrc=${artifactsDirSrc} artifactsDirDest=${artifactsDirDest}`);
            await this._pullArtifacts(dockerContainer, artifactsDirSrc, artifactsDirDest);
          } catch (e) {
            reject(e);
          }
        }


        const execInspect = await exec.inspect();
        const exitCode = execInspect.ExitCode;

        logger.debug(`Reading exit code from job. jobName=${name} exitCode=${exitCode}`);

        const ciOutput = await this.exec(dockerContainer, {
          Cmd: ['sh', '-c', 'if [ -f "$CI_OUTPUT" ] && [ -s "$CI_OUTPUT" ]; then cat "$CI_OUTPUT" && rm "$CI_OUTPUT"; else echo ""; fi'],
          AttachStdout: true,
        });
        const outputStream = await ciOutput.start({ hijack: true, stdin: false });
        let out = null;
        outputStream.on('data', (chunk) => {
          // remove first 8 bytes
          // (for reference https://github.com/moby/moby/issues/7375#issuecomment-51462963)
          out = chunk.toString(); // Log the CI_OUTPUT to the console
          out = out.substr(8).trim();
          logger.debug(`Final step of job done, reading output. jobName=${name}`);
          // TODO: 1 --- consider making this "fire-and-forget" if it's in CI mode,
          // that way we don't need to wait for containers to be destroyed before
          // seeing output
          if (subcontainer) {
            logger.debug(`Cleaning up container. containerId=${subcontainer.id}`);
            this._destroyContainer(subcontainer);
            logger.debug(`Done cleaning up container. containerId=${subcontainer.id}`);
          }
          resolve({ exitCode, output: out });
        });
        outputStream.on('error', (err) => {
          logger.debug(`Final step of job failed, reading output. jobName=${name}`);
          if (subcontainer) {
            logger.debug(`Cleaning up container. containerId=${subcontainer.testContainer.getId()}`);
            this._destroyContainer(subcontainer);
            logger.debug(`Done cleaning up container. containerId=${subcontainer.testContainer.getId()}`);
          }
          reject(new Error(`failed to write output to $CI_OUTPUT err=${err}`));
        });
      });
    });
  }

  async runService () {

  }

  async stopExec (name) {
    // if no name provided, stop everything
    if (this.runningJob === name || !name) {
      await Promise.all([
        this._stopMainExec(),
        this.stopSubContainers(this.imageName),
      ]);
      return;
    }
  }

  /**
   * kills the process running in the main container, but do
   * not kill the container, leave it running
   */
  async _stopMainExec () {
    this.runningJob = null;
    const dockerContainer = this.docker.getContainer(this.testContainer.getId());

    // kill the "sh" process which is what runs all processes
    const exec = await this.exec(dockerContainer, {
      Cmd: ['pkill', 'sh'], // You can use `-TERM` for graceful shutdown, or `-9` for forceful
      AttachStdout: true,
      AttachStderr: true
    });

    const killStream = await exec.start({ hijack: true, stdin: false });
    await new Promise((resolve) => {
      killStream.on('end', function () {
        resolve();
      });
      killStream.on('data', () => {
        // for some reason, 'end' is only triggered when this event is set
      });
    });
  }

  async stop () {
    return await Promise.all([
      this.testContainer?.stop(),
      this.stopSubContainers(this.imageName),
    ]);
  }

  _createValidContainerName (name) {
    return name.replace(/\s+/g, '_') // Replace whitespace with underscores
               .replace(/[^a-zA-Z0-9_.-]/g, ''); // Remove invalid characters
  }

  async _commitClonedImage () {
    if (this.imageName) {
      return this.imageName;
    }
    if (this.clonePromise) {
      return await this.clonePromise;
    }
    this.clonePromise = new Promise((resolve) => {
      const container = this.testContainer.container;
      container.commit().then((res) => {
        resolve(res.Id);
      });
    });
    return await this.clonePromise;
  }

  async _cloneContainer ({ name, image, workDir }) {
    logger.debug(`Cloning a container. name=${name} image=${image}`);
    const subcontainer = new Subcontainer();

    // create a new image that clones the main container
    const randString = Math.random().toString().substring(2, 10);
    subcontainer.setId(randString);
    this.subcontainers.set(randString, subcontainer);

    if (!image) {
      subcontainer.setImage(this.imageName);

      // if the job was invalidated while the image was being created,
      // then remove the image
    }

    // start a new container from this newly created image
    const containerName = this._createValidContainerName(this.containerName + '_' + name + '_' + randString);
    const newContainer = await new GenericContainer(image || this.imageName)
      .withName(containerName)
      .withWorkingDir(workDir)
      .withStartupTimeout(120000)
      .withPrivilegedMode(true)
      .start();

    logger.debug(`Container is ready. jobName=${name} name=${containerName} id=${newContainer.getId()}`);

    subcontainer.setContainer(newContainer);

    // if the job was invalidated in the middle of the container being created,
    // remove the container and image
    if (!this.subcontainers.has(subcontainer.id)) {
      await newContainer.container.remove({ force: true });
      return null;
    }

    return subcontainer;
  }

  async _destroyContainer (subcontainer) {
    // Remove the entry from subcontainers
    const testContainer = subcontainer.testContainer;
    if (!testContainer || testContainer.isKilled) {
      logger.debug(`Skipping destroying container that was already destroyed.`);
      return;
    }
    const containerId = subcontainer.testContainer?.getId();
    logger.debug(`Destroying container. containerId=${containerId}`);
    this.subcontainers.delete(subcontainer.id);
    try {
      const container = await subcontainer?.testContainer?.container;
      if (container) {
        await container.stop();
        return await subcontainer?.testContainer?.container?.remove({ force: true });
      }
    } catch (e) {
      logger.error(`Failed to destroy error. err=${e}`);
    }
  }

  /**
   * Wait for a container to either
   * @param {*} container
   * @returns
   */
  async _waitForContainerToUnpause (container) {
    let isPaused, isRestarting;

    do {
      const containerInfo = await container.inspect();
      const state = containerInfo.State;
      isPaused = state.Paused;
      isRestarting = state.Restarting;
      if (isPaused || isRestarting) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        return state;
      }
    } while (isPaused || isRestarting);
  }

  async _pullArtifacts (dockerContainer, srcContainerDir, destHostedDir) {
    // get the archive from the source container directory
    await this._waitForContainerToUnpause(dockerContainer);
    const archiveStream = await dockerContainer.getArchive({ path: srcContainerDir });

    // create a writable stream to the destination directory on the host
    const archiveFilepath = path.join(destHostedDir, 'archive.tar');
    const destStream = fs.createWriteStream(archiveFilepath); // Create a tar file in the destination directory

    // pipe the archive stream to the destination stream
    archiveStream.pipe(destStream);

    return new Promise((resolve, reject) => {
      destStream.on('finish', () => {
        // Extract the tar file to the destination directory
        // TODO: 1 -- fix extraction to include files and not include the containing directory
        //    -- e.g.) /coverage/lcov/ should be /lcov/ instead
        const extract = require('tar').extract({ cwd: destHostedDir });
        fs.createReadStream(archiveFilepath).pipe(extract)
          .on('finish', async () => {
            await fs.promises.rm(archiveFilepath);
            resolve();
          })
          .on('error', (err) => {
            logger.error(`Failed to pipe archive from ${archiveFilepath}. err=${err}`);
            reject(err);
          });
      });
      destStream.on('error', function (err) {
        logger.error(`Failed to pipe from container '${archiveStream}' to hosted '${destStream}'. err=${err}`);
        reject(err);
      });
    });
  }
}

class Subcontainer {
  setName (name) { this.name = name; }
  setContainer (container) { this.testContainer = container; }
  setImage (image) { this.image = image; }
  setId (id) { this.id = id; }
}

module.exports = DockerExecutor;
