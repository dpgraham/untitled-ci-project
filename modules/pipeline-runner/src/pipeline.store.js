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
  maxConcurrency: 1, // TODO: Change this to 2 once the container cloning is ready
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
  sortJobs: () => set((state) => produce(state, (draft) => {
    for (let i = 0; i < draft.jobs.length; i++) {
      const job = draft.jobs[i];
      if (job.group) {
        const group = job.group;
        for (let j = i + 1; j < draft.jobs.length; j++) {
          if (draft.jobs[j].group === group) {
            const [movedJob] = draft.jobs.splice(j, 1); // Remove job from j
            draft.jobs.splice(i + 1, 0, movedJob); // Insert job at i
            i += 1;
          }
        }
      }
    }
  })),
  setImage: (image) => set({ image }),
  addJob: (job) => set((state) => ({ jobs: [...state.jobs, job] })),
  addStep: (step) => set((state) => {
    const updatedJobs = [...state.jobs];
    const lastJob = updatedJobs[updatedJobs.length - 1];
    lastJob.steps = lastJob.steps || [];
    lastJob.steps.push(step);
    return { jobs: updatedJobs };
  }),
  setFiles: (files) => set({ files }),
  addIgnorePatterns: (patterns) => set((state) => ({ ignorePatterns: [...state.ignorePatterns, ...patterns] })),
  reset: () => set((state) => ({
    ...state,
    jobs: state.jobs.map((job) => ({ ...job, status: JOB_STATUS.PENDING })), // Update job statuses to JOB_STATUS.PENDING
  })),
  setJobExitCode: (jobIndex, exitCode) => set((state) => {
    const updatedJobs = [...state.jobs];
    updatedJobs[jobIndex] = { ...updatedJobs[jobIndex], exitCode };
    return { jobs: updatedJobs };
  }),
  setMaxConcurrency: (maxConcurrency) => set({ maxConcurrency }),
  setOutputDir: (outputDir) => set({ outputDir }),
  setWorkDir: (workDir) => {
    if (!workDir.startsWith('/')) {
      workDir = `/${workDir}`;
    }
    set({ workDir });
  },
  setStatus: (status) => set({ status }),
  setResult: (result) => set({ result }),
  pipelineFile: null, // Add this line to store the pipeline file path
  setPipelineFile: (filePath) => set({ pipelineFile: filePath }), // Add this setter function
  getPipelineStatus: () => {
    const jobs = pipelineStore.getState().jobs;
    const allPassed = jobs.every((job) => job.status === JOB_STATUS.PASSED);
    const anyFailed = jobs.some((job) => job.status === JOB_STATUS.FAILED);
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
    while (concurrency < maxConcurrency) {
      const state = pipelineStore.getState();
      const nextJob = state.jobs.find((job) => job.status === JOB_STATUS.QUEUED); // Find the first queued job
      if (nextJob) {
        state.setJobStatus(nextJob, JOB_STATUS.RUNNING); // Set the status of the next job to JOB_STATUS.RUNNING
        concurrency++;
        jobs.push({ ...nextJob });
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
  }
}));

module.exports = pipelineStore;
module.exports.JOB_STATUS = JOB_STATUS;
module.exports.PIPELINE_STATUS = PIPELINE_STATUS;
