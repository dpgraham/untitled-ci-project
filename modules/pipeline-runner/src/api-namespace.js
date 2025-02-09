const pipelineStore = require('./pipeline.store');

const { JOB_STATUS } = pipelineStore;

const apiNamespace = {};
let currentJob = null;

// Pipeline definition functions
apiNamespace.image = (imageName) => {
  pipelineStore.getState().setImage(imageName, currentJob);
};

apiNamespace.job = (name, fn) => {
  const jobDef = { name, steps: [], onFilesChanged: null };
  currentJob = pipelineStore.getState().addJob({...jobDef, status: JOB_STATUS.PENDING});
  fn(jobDef);
  currentJob = null;
};

apiNamespace.env = (name, value) => {
  if (typeof(value) === 'undefined') {
    throw new Error(`"env" requires two arguments: name, value`);
  }
  pipelineStore.getState().setEnv(name, value, currentJob);
};

apiNamespace.secret = (name, value) => {
  if (typeof(value) === 'undefined') {
    throw new Error(`"secret" requires two arguments: name, value`);
  }
  pipelineStore.getState().setEnv(name, value, currentJob, true);
};

apiNamespace.step = (command) => {
  pipelineStore.getState().addStep({ command }, currentJob);
};

apiNamespace.files = (globPattern) => {
  pipelineStore.getState().setFiles(globPattern);
};

apiNamespace.ignore = (...patterns) => {
  pipelineStore.getState().addIgnorePatterns(patterns);
};

apiNamespace.output = (dir) => {
  const state = pipelineStore.getState();
  state.setOutputDir(dir);
  state.addIgnorePatterns([dir]);
};

apiNamespace.concurrency = (concurrency) => {
  pipelineStore.getState().setMaxConcurrency(concurrency);
};

apiNamespace.workdir = (workdir) => {
  pipelineStore.getState().setWorkDir(workdir);
};

apiNamespace.onFilesChanged = (pattern) => {
  pipelineStore.getState().setOnFilesChanged(pattern, currentJob);
};

apiNamespace.group = (name) => {
  pipelineStore.getState().setGroup(name, currentJob);
};

apiNamespace.copy = (src) => {
  pipelineStore.getState().addCopy(src, currentJob);
};

apiNamespace.artifacts = (artifactsDir) => {
  pipelineStore.getState().setArtifactsDir(artifactsDir, currentJob);
};

apiNamespace.skip = () => {
  pipelineStore.getState().setSkip(currentJob);
};

apiNamespace.service = () => {
  pipelineStore.getState().setIsServer(currentJob);
};

module.exports = apiNamespace;
module.exports.default = apiNamespace;
