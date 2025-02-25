const { create } = require('zustand');
const { produce } = require('immer');
const picomatch = require('picomatch');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const JOB_STATUS = {
  PENDING: 'pending',
  QUEUED: 'queued',
  RUNNING: 'running',
  PASSED: 'passed',
  FAILED: 'failed',
};

const JOB_RESULT = {
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  TIMEOUT: 'timeout',
};

const PIPELINE_STATUS = {
  QUEUED: 'queued',
  IN_PROGRESS: 'in progress',
  PASSED: 'passed',
  FAILED: 'failed',
};

const createPipelineStore = (set) => ({
  jobs: [],
  image: null,
  files: './',
  ignorePatterns: [],
  result: 'in progress',
  maxConcurrency: 2,
  outputDir: 'ci-output',
  workDir: '/ci',
  enqueueJobs: () => set((state) => produce(state, (draft) => {
    let group;

    // if there are any failed jobs, do not enqueue any more, the pipeline is dead
    const failingJob = draft.jobs.find((job) => job.status === JOB_STATUS.FAILED);
    if (failingJob) {
      return;
    }

    const queuedJob = draft.jobs.find((job) => job.status === JOB_STATUS.QUEUED);
    if (queuedJob) {
      return;
    }

    // find the first job in the group that is "pending" and change it to "queued"
    const pendingJob = draft.jobs.find((job) => job.status === JOB_STATUS.PENDING && job.result !== JOB_RESULT.SKIPPED);
    if (pendingJob) {
      group = pendingJob.group;
      pendingJob.status = JOB_STATUS.QUEUED;
      draft.status = PIPELINE_STATUS.IN_PROGRESS;
    }

    // any other jobs in the group need to be queued to
    if (group) {
      for (const job of draft.jobs) {
        if (job.group === group) {
          if (job.status === JOB_STATUS.PENDING) {
            job.status = JOB_STATUS.QUEUED;
          }
        }
      }
    }
  })),
  setJobId: (job) => {
    let jobId = uuidv4();
    set((state) => produce(state, (draft) => {
      for (const checkJob of draft.jobs) {
        if (checkJob.name === job.name) {
          checkJob.id = jobId;
        }
      }
    }));
    return jobId;
  },
  setImage: (image, job) => set((state) => produce(state, (draft) => {
    if (!job) {
      draft.image = image;
      return;
    }
    for (const checkJob of draft.jobs) {
      if (checkJob.name === job.name) {
        checkJob.image = image;
      }
    }
  })),
  addJob: (job) => {
    set((state) => produce(state, (draft) => {
      job.workDir = job.workDir || '/ci';
      draft.jobs.push(job);
    }));
    return pipelineStore.getState().jobs[pipelineStore.getState().jobs.length - 1];
  },
  addCopy: (src, dest, currentJob) => set((state) => produce(state, (draft) => {
    for (const job of draft.jobs) {
      if (currentJob.name === job.name) {
        let destPath = path.posix.join(job.workDir, dest);
        job.copy = [...(job.copy || []), { src, dest: destPath }];
      }
    }
  })),
  setLogfilePaths: () => set((state) => produce(state, (draft) => {
    const { outputDir } = state;
    for (const job of draft.jobs) {
      const logFilePath = path.join(outputDir, 'jobs', job.name, 'logs.log');
      job.logFilePath = logFilePath;
      job.fullLogFilePath = path.join(state.pipelineDir, logFilePath);
    }
  })),
  setEnv: (envName, value, job, isSecret) => set((state) => produce(state, (draft) => {
    if (job) {
      for (const checkJob of draft.jobs) {
        if (checkJob.name === job.name) {
          checkJob.env = checkJob.env || {};
          checkJob.env[envName] = value;
          if (isSecret) {
            checkJob.secrets = checkJob.secrets || {};
            checkJob.secrets[envName] = value;
          }
          return;
        }
      }
    }
    draft.env = draft.env || {};
    draft.env[envName] = value;
    if (isSecret) {
      draft.secrets = draft.secrets || {};
      draft.secrets[envName] = value;
    }
  })),
  getEnv: (job) => {
    const globalEnv = pipelineStore.getState().env || {};
    const jobs = pipelineStore.getState().jobs;
    let jobEnv = {};
    for (const checkJob of jobs) {
      if (checkJob.name === job.name) {
        jobEnv = checkJob.env || {};
      }
    }
    return {...globalEnv, ...jobEnv};
  },
  getSecrets: (job) => {
    const globalEnv = pipelineStore.getState().secrets || {};
    const jobs = pipelineStore.getState().jobs;
    let jobEnv = {};
    for (const checkJob of jobs) {
      if (checkJob.name === job.name) {
        jobEnv = checkJob.secrets || {};
      }
    }
    return {...globalEnv, ...jobEnv};
  },
  addStep: (step, currentJob) => set((state) => produce(state, (draft) => {
    if (!currentJob) {
      throw new Error(`Error: 'step' must be called inside a 'job'`);
    }
    for (const job of draft.jobs) {
      if (job.name === currentJob.name) {
        job.steps.push(step);
      }
    }
  })),
  setFiles: (files) => set({ files }),
  addIgnorePatterns: (patterns) => set((state) => ({ ignorePatterns: [...state.ignorePatterns, ...patterns] })),
  reset: () => set((state) => ({
    ...state,
    jobs: [],
  })),
  setMaxConcurrency: (maxConcurrency) => set({ maxConcurrency }),
  setOutputDir: (outputDir) => set({
    outputDir,
    fullOutputDir: process.cwd() + '/' + outputDir,
  }),
  setWorkDir: (workDir, currentJob) => set((state) => produce(state, (draft) => {
    if (!workDir.startsWith('/')) {
      workDir = `/${workDir}`;
    }
    if (!currentJob) {
      draft.workDir = workDir;
    }
    for (const job of draft.jobs) {
      if (job.name === currentJob.name) {
        job.workDir = workDir;
      }
    }
  })),
  setGroup: (group, currentJob) => set((state) => produce(state, (draft) => {
    if (!currentJob) {
      throw new Error(`Error: 'group' must be called inside a 'job'`);
    }
    for (const job of draft.jobs) {
      if (job.name === currentJob.name) {
        job.group = group;
      }
    }
  })),
  setJobOutput: (output, job) => set((state) => produce(state, (draft) => {
    for (const checkJob of draft.jobs) {
      if (checkJob.name === job.name) {
        checkJob.output = output;
      }
    }
  })),
  getJobOutputs: () => {
    const out = {};
    for (const checkJob of pipelineStore.getState().jobs) {
      if (checkJob.output) {
        out[checkJob.name] = checkJob.output;
      }
    }
    return out;
  },
  setOnFilesChanged: (onFilesChanged, currentJob) => set((state) => produce(state, (draft) => {
    if (!currentJob) {
      throw new Error(`Error: 'onFilesChanged' must be called inside a 'job'`);
    }
    for (const job of draft.jobs) {
      if (job.name === currentJob.name) {
        job.onFilesChanged = onFilesChanged;
      }
    }
  })),
  setExitOnDone: (exitOnDone) => set({ exitOnDone }),
  setStatus: (status) => set({ status }),
  setResult: (result) => set({ result }),
  pipelineFile: null,
  setPipelineFile: (filePath) => set((state) => ({
    pipelineFile: filePath,
    pipelineDir: path.dirname(filePath),
    pipelineFileBasename: path.basename(filePath),
    fullOutputDir: process.cwd() + '/' + state.outputDir
  })),
  setJobStatus: (job, status) => set((state) => produce(state, (draft) => {
    let jobs = draft.jobs;
    for (const checkJob of jobs) {
      if (checkJob.name === job.name) {
        checkJob.status = status;
      }
    }

    // update the pipeline status in response to the job status changing
    jobs = jobs.filter((job) => !job.skip);
    const allPassed = jobs.every((job) => job.status === JOB_STATUS.PASSED);
    const anyFailed = jobs.some((job) => job.status === JOB_STATUS.FAILED);
    const noneQueued = jobs.every((job) => job.status !== JOB_STATUS.QUEUED);
    const noneRunning = jobs.every((job) => job.status !== JOB_STATUS.RUNNING);
    if (allPassed && noneQueued && noneRunning) {
      draft.status = PIPELINE_STATUS.PASSED; // Set to PASSED if all jobs are PASSED
    } else if (anyFailed && noneQueued && noneRunning) {
      draft.status = PIPELINE_STATUS.FAILED; // Set to FAILED if at least one job is FAILED
    } else {
      draft.status = PIPELINE_STATUS.IN_PROGRESS; // Set to IN_PROGRESS otherwise
    }
  })),
  setJobResult: (job, result) => set((state) => produce(state, (draft) => {
    for (const checkJob of draft.jobs) {
      if (checkJob.name === job.name) {
        checkJob.result = result;
      }
    }
  })),
  setJobFilePath: (job, filePath) => set((state) => produce(state, (draft) => {
    for (const checkJob of draft.jobs) {
      if (checkJob.name === job.name) {
        checkJob.filePath = filePath;
      }
    }
  })),
  dequeueNextJobs: () => {
    let jobs = [];
    let { maxConcurrency } = pipelineStore.getState();
    let concurrency = pipelineStore.getState().getRunningJobsCount();
    let group;
    while (concurrency < maxConcurrency) {
      const state = pipelineStore.getState();
      const nextJob = state.jobs.find((job) => {
        return job.status === JOB_STATUS.QUEUED &&
          (group === job.group || !group);
      }); // Find the first queued job
      group = nextJob?.group;
      if (nextJob) {
        state.setJobStatus(nextJob, JOB_STATUS.RUNNING);
        concurrency++;
        jobs.push({ ...nextJob });
        if (!group) {
          break;
        }
      } else {
        break;
      }
    }
    return jobs;
  },
  setArtifactsDir: (artifactsDir, job) => set((state) => produce(state, (draft) => {
    for (const checkJob of draft.jobs) {
      if (checkJob.name === job.name) {
        checkJob.artifactsDir = artifactsDir;
      }
    }
  })),
  setSkip: (job) => set((state) => produce(state, (draft) => {
    for (const checkJob of draft.jobs) {
      if (checkJob.name === job.name) {
        checkJob.skip = true;
        checkJob.status = JOB_STATUS.PASSED;
        checkJob.result = JOB_RESULT.SKIPPED;
      }
    }
  })),
  getRunningJobsCount: () => {
    const jobs = pipelineStore.getState().jobs;
    return jobs.filter((job) => job.status === JOB_STATUS.RUNNING).length;
  },
  resetJobs: (filepath) => {
    let invalidatedJobs = [];
    set((state) => produce(state, (draft) => {
      let i = 0;
      while (i < draft.jobs.length) {
        let job = draft.jobs[i];

        // if jobs from a previous "group" were invalidated, then
        // invalidate all jobs from here
        if (invalidatedJobs.length > 0) {
          if (job.status !== JOB_STATUS.PENDING && job.result !== JOB_RESULT.SKIPPED) {
            invalidatedJobs.push(job.name);
            job.status = JOB_STATUS.PENDING;
          }
          i++;
          continue;
        }

        // check all the jobs in this current group (an 'undefined' group means a group of one)
        // and if the filematcher matches then switch the job to "PENDING"
        const group = job.group;
        while (job?.group === group) {
          if (!job.onFilesChanged || picomatch(job.onFilesChanged, { dot: true })(filepath)) {
            if (job.status !== JOB_STATUS.PENDING) {
              invalidatedJobs.push(job.name);
              job.status = JOB_STATUS.PENDING;
            }
          }
          i++;
          if (!group) {
            break;
          }
          job = draft.jobs[i];
        }
      }
    }));

    return invalidatedJobs;
  },
  validatePipeline: () => set((state) => produce(state, (draft) => {
    // check for duplicate job names
    draft.isInvalidPipeline = false;
    draft.invalidReason = null;
    const jobNames = new Set();
    const duplicateJobNames = [];
    for (const job of state.jobs) {
      if (jobNames.has(job.name)) {
        draft.isInvalidPipeline = true;
        duplicateJobNames.push(job.name);
      } else {
        jobNames.add(job.name);
      }
    }
    if (duplicateJobNames.length > 0) {
      draft.invalidReason = `Pipeline is invalid. ` +
        `Job names must be unique. Found instances of jobs with duplicate names: '` +
        `${duplicateJobNames.join('\',')}'.`;
      return;
    }
  })),
});

let onStateChangeHandlers = [];

const handleStateChange = function (cb) {
  onStateChangeHandlers.push(cb);
};

const removeStateChangeHandler = function (cb) {
  onStateChangeHandlers = onStateChangeHandlers.filter((handler) => handler !== cb);
};

// Middleware to log state changes
const logMiddleware = (config) => (set, get, api) =>
  config(
    (args) => {
      set(args);
      const newState = get();
      onStateChangeHandlers.forEach((cb) => cb(newState));
    },
    get,
    api
  );

const pipelineStore = create(logMiddleware(createPipelineStore));


module.exports = pipelineStore;
module.exports.JOB_STATUS = JOB_STATUS;
module.exports.JOB_RESULT = JOB_RESULT;
module.exports.PIPELINE_STATUS = PIPELINE_STATUS;
module.exports.handleStateChange = handleStateChange;
module.exports.removeStateChangeHandler = removeStateChangeHandler;
