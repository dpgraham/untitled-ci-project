const { create } = require('zustand');
const { produce } = require('immer');
const picomatch = require('picomatch');

const JOB_STATUS = {
  PENDING: 'pending',
  QUEUED: 'queued',
  RUNNING: 'running',
  PASSED: 'passed',
  FAILED: 'failed',
};

const PIPELINE_STATUS = {
  IN_PROGRESS: 'in progress',
  PASSED: 'passed',
  FAILED: 'failed',
};

const pipelineStore = create((set) => ({
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
    for (const job of draft.jobs) {
      if (job.status === JOB_STATUS.RUNNING) {
        break;
      } else if (group) {
        if (group === job.group) {
          job.status = JOB_STATUS.QUEUED;
        } else {
          break;
        }
      } else if (job.status === JOB_STATUS.PENDING) {
        job.status = JOB_STATUS.QUEUED;
        group = job.group;
        if (!group) {break;}
      }
    }
  })),
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
      draft.jobs.push(job);
    }));
    return pipelineStore.getState().jobs[pipelineStore.getState().jobs.length - 1];
  },
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
  addStep: (step) => set((state) => produce(state, (draft) => {
    if (draft.jobs.length === 0) {
      throw new Error(`Invalid pipeline. "step" must be called from within a job.`);
    }
    draft.jobs[draft.jobs.length - 1].steps.push(step);
  })),
  setFiles: (files) => set({ files }),
  addIgnorePatterns: (patterns) => set((state) => ({ ignorePatterns: [...state.ignorePatterns, ...patterns] })),
  reset: () => set((state) => ({
    ...state,
    jobs: [],
  })),
  setMaxConcurrency: (maxConcurrency) => set({ maxConcurrency }),
  setOutputDir: (outputDir) => set({ outputDir }),
  setWorkDir: (workDir) => {
    if (!workDir.startsWith('/')) {
      workDir = `/${workDir}`;
    }
    set({ workDir });
  },
  setGroup: (group) => set((state) => produce(state, (draft) => {
    if (draft.jobs.length === 0) {
      throw new Error(`Invalid pipeline. Must set "group" on a job`);
    }
    draft.jobs[draft.jobs.length - 1].group = group;
  })),
  setOnFilesChanged: (onFilesChanged) => set((state) => produce(state, (draft) => {
    // TODO: use "currentJob" instead of the last job
    if (draft.jobs.length === 0) {
      throw new Error(`Invalid pipeline. Must set "onFilesChanged" on a job`);
    }
    draft.jobs[draft.jobs.length - 1].onFilesChanged = onFilesChanged;
  })),
  setStatus: (status) => set({ status }),
  setResult: (result) => set({ result }),
  pipelineFile: null, // Add this line to store the pipeline file path
  setPipelineFile: (filePath) => set({ pipelineFile: filePath }), // Add this setter function
  getPipelineStatus: () => {
    const jobs = pipelineStore.getState().jobs;
    const allPassed = jobs.every((job) => job.status === JOB_STATUS.PASSED);
    const anyFailed = jobs.some((job) => job.status === JOB_STATUS.FAILED) &&
      jobs.every((job) => [JOB_STATUS.PASSED, JOB_STATUS.FAILED].includes(job.status));
    if (allPassed) {
      return PIPELINE_STATUS.PASSED; // Set to PASSED if all jobs are PASSED
    } else if (anyFailed) {
      return PIPELINE_STATUS.FAILED; // Set to FAILED if at least one job is FAILED
    } else {
      return PIPELINE_STATUS.IN_PROGRESS; // Set to IN_PROGRESS otherwise
    }
  },
  setJobStatus: (job, status) => set((state) => produce(state, (draft) => {
    for (const checkJob of draft.jobs) {
      if (checkJob.name === job.name) {
        checkJob.status = status;
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
        state.setJobStatus(nextJob, JOB_STATUS.RUNNING); // Set the status of the next job to JOB_STATUS.RUNNING
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
  getRunningJobsCount: () => {
    const jobs = pipelineStore.getState().jobs;
    return jobs.filter((job) => job.status === JOB_STATUS.RUNNING).length;
  },
  resetJobs: (filepath) => {
    let hasInvalidatedAJob = false;
    set((state) => produce(state, (draft) => {
      for (const job of draft.jobs) {
        if (
          !job.onFilesChanged ||
            picomatch(job.onFilesChanged, { dot: true })(filepath) ||
            hasInvalidatedAJob
        ) {
          if (job.status !== JOB_STATUS.PENDING) {
            job.status = JOB_STATUS.PENDING;
            hasInvalidatedAJob = true;
          }
        }
      }
    }));
    return hasInvalidatedAJob;
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
}));

module.exports = pipelineStore;
module.exports.JOB_STATUS = JOB_STATUS;
module.exports.PIPELINE_STATUS = PIPELINE_STATUS;
