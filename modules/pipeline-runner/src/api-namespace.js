const pipelineStore = require('./pipeline.store');

const { JOB_STATUS } = pipelineStore;

const apiNamespace = {};

// Pipeline definition functions
apiNamespace.image = (imageName) => {
  pipelineStore.getState().setImage(imageName);
};

let currentJob = null;

apiNamespace.job = (name, fn) => {
  const jobDef = { name, steps: [], onFilesChanged: null };
  currentJob = pipelineStore.getState().addJob({...jobDef, status: JOB_STATUS.PENDING});
  fn(jobDef);
  currentJob = null;
};

apiNamespace.env = (name, value) => {
  pipelineStore.getState().setEnv(name, value, currentJob);
};

apiNamespace.secret = (name, value) => {
  pipelineStore.getState().setEnv(name, value, currentJob, true);
};

apiNamespace.step = (command) => {
  pipelineStore.getState().addStep({ command });
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
  pipelineStore.getState().setOnFilesChanged(pattern);
};

apiNamespace.group = (name) => {
  pipelineStore.getState().setGroup(name);
};

module.exports = apiNamespace;
module.exports.default = apiNamespace;
