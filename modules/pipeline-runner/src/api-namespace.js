const pipelineStore = require('./pipeline.store');

const { JOB_STATUS } = pipelineStore;

const apiNamespace = {};
let currentJob = null;

/**
 * Files that are copied from local host machine to the main docker container
 *
 * @param {string} globPattern
 */
apiNamespace.files = (globPattern) => {
  pipelineStore.getState().setFiles(globPattern);
};

/**
 * File patterns to exclude from files
 *
 * This is to exclude things like "node_modules/"
 *
 * @param  {...string} patterns
 */
apiNamespace.ignore = (...patterns) => {
  pipelineStore.getState().addIgnorePatterns(patterns);
};

/**
 * The image used to build the main container to run the pipeline or an individual job
 *
 * If this isn't set at the global level, Carry-On will default to Alpine
 * @param {string} imageName name of Docker image
 */
apiNamespace.image = (imageName) => {
  pipelineStore.getState().setImage(imageName, currentJob);
};

/**
 * A job that is run as part of the pipeline
 *
 * @param {string} name Name of the job. Must be unique.
 * @param {function} fn Callback. Anything called within this is part of this job's scope
 */
apiNamespace.job = (name, fn) => {
  const jobDef = { name, steps: [], onFilesChanged: null };
  currentJob = pipelineStore.getState().addJob({...jobDef, status: JOB_STATUS.PENDING});
  fn(jobDef);
  currentJob = null;
};

/**
 * Set a single environment variable in pipeline or a job
 *
 * @param {string} name Env name
 * @param {string} value Env value
 */
apiNamespace.env = (name, value) => {
  if (typeof (value) === 'undefined') {
    throw new Error(`"env" requires two arguments: name, value`);
  }
  pipelineStore.getState().setEnv(name, value, currentJob);
};

/**
 * Set a secret single environment variable in pipeline or a job
 *
 * The difference between this and "env" is that secrets are redacted from logs via regex
 * matching
 *
 * @param {string} name Env name
 * @param {string} value Env value
 */
apiNamespace.secret = (name, value) => {
  if (typeof (value) === 'undefined') {
    throw new Error(`"secret" requires two arguments: name, value`);
  }
  pipelineStore.getState().setEnv(name, value, currentJob, true);
};

/**
 * A command to be run inside of a job.
 *
 * These can only be defined inside job(...) and are run sequentially in order
 * of when they were defined
 * @param {string} command SH command
 */
apiNamespace.step = (command) => {
  pipelineStore.getState().addStep({ command }, currentJob);
};

/**
 * Permanently stop the container execution without closing the container so that
 * a user can inspect the contents of a container
 */
apiNamespace.step.break = () => {
  const message = `'${currentJob.name}' breakpoint reached.
    To shell into this container, run: "docker exec -it $CONTAINER_ID sh"
  `;
  const command = `echo '${message}'; tail -f /dev/null`;
  pipelineStore.getState().addStep({ command }, currentJob);
  pipelineStore.getState().setJobAttribute(currentJob, 'break', true);
};

/**
 * The directory in the host machine where job output should be saved to
 *
 * Default is "ci-output/"
 *
 * @param {string} dir
 */
apiNamespace.output = (dir) => {
  const state = pipelineStore.getState();
  state.setOutputDir(dir);
  state.addIgnorePatterns([dir]);
};

/**
 * Limits number of containers allowed to run concurrently
 *
 * Default is 2
 * @param {number} concurrency
 */
apiNamespace.concurrency = (concurrency) => {
  pipelineStore.getState().setMaxConcurrency(concurrency);
};

/**
 * Path in container where files are copied to and where commands are run
 *
 * @param {string} workdir
 */
apiNamespace.workdir = (workdir) => {
  pipelineStore.getState().setWorkDir(workdir, currentJob);
};

/**
 * Defined inside a job so that the job is only re-run if these files are updated
 *
 * This is so that you don't re-run jobs needlessly. For example, if you have a NodeJS
 * pipeline that installs dependencies, you would set "onFilesChanged('package*.json')"
 * so that it only re-runs when package.json or package-lock.json is updated
 * @param {string} pattern
 */
apiNamespace.onFilesChanged = (pattern) => {
  pipelineStore.getState().setOnFilesChanged(pattern, currentJob);
};

/**
 * Make the job part of a group
 *
 * By making a job part of a group, all the jobs in the group will be run concurrently
 * (up to a limit) instead of being run sequentially. Because they're being run
 * sequentially, the containers they run in will be clones of the main container
 *
 * @param {string} name
 */
apiNamespace.group = (name) => {
  pipelineStore.getState().setGroup(name, currentJob);
};

/**
 * Copy files from the main container to a clone container
 *
 * This is only applicable if you set "group" or "image" in a job
 * @param {string} src
 */
apiNamespace.copy = (src, dest) => {
  pipelineStore.getState().addCopy(src, dest, currentJob);
};

/**
 * Save artifacts from container to the host. Can be found in output dir
 * @param {string} artifactsDir
 */
apiNamespace.artifacts = (artifactsDir) => {
  pipelineStore.getState().setArtifactsDir(artifactsDir, currentJob);
};

/**
 * Skips the job
 */
apiNamespace.skip = () => {
  pipelineStore.getState().setSkip(currentJob);
};

/**
 * Commit and tag the container when done
 * @param {string} tagName
 */
apiNamespace.tag = (tagName) => {
  pipelineStore.getState().setTagName(tagName, currentJob);
};

/**
 * Set the Docker command (Cmd)
 * @param {string} command
 */
apiNamespace.command = (command) => {
  pipelineStore.getState().setJobAttribute(currentJob, 'command', command);
};

/**
 * Set the Docker entrypoint (Entrypoint)
 * @param {string} entrypoint
 */
apiNamespace.entrypoint = (entrypoint) => {
  pipelineStore.getState().setJobAttribute(currentJob, 'entrypoint', entrypoint);
};

/**
 * Set the shell program to use (default is /sh)
 *
 * e.g.) "bash"
 * @param {string} shell
 */
apiNamespace.shell = (shell) => {
  pipelineStore.getState().setJobAttribute(currentJob, 'shell', shell);
};

// apiNamespace.service = () => {
//   pipelineStore.getState().setIsServer(currentJob);
// };

module.exports = apiNamespace;
module.exports.default = apiNamespace;
