const { create } = require('zustand');
const { produce } = require('immer');
const picomatch = require('picomatch');

const pipelineStore = create((set) => ({
  jobs: [],
  image: null,
  files: './',
  ignorePatterns: [],
  status: 'pending',
  result: 'in progress',
  enqueueJobs: () => set((state) => produce(state, (draft) => {
    let group;
    for (const job of draft.jobs) {
      if (job.status === 'pending') {
        job.status = 'queued';
        group = job.group;
        if (!group) break;
      } else if (group) {
        if (group === job.group) {
          job.status = 'queued';
        } else {
          break;
        }
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
    jobs: state.jobs.map((job) => ({ ...job, status: 'pending' })), // Update job statuses to 'pending'
  })),
  setJobExitCode: (jobIndex, exitCode) => set((state) => {
    const updatedJobs = [...state.jobs];
    updatedJobs[jobIndex] = { ...updatedJobs[jobIndex], exitCode };
    return { jobs: updatedJobs };
  }),
  setStatus: (status) => set({ status }),
  setResult: (result) => set({ result }),
  pipelineFile: null, // Add this line to store the pipeline file path
  setPipelineFile: (filePath) => set({ pipelineFile: filePath }), // Add this setter function
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
  getNextJob: () =>
    pipelineStore.getState().jobs.find((job) => job.status === 'queued') // Find the first queued job
  ,
  resetJobs: (filepath) => {
    let hasInvalidatedAJob = false;
    set((state) => produce(state, (draft) => {
      for (const job of draft.jobs) {
        if (
          !job.onFilesChanged ||
            picomatch(job.onFilesChanged, { dot: true })(filepath) ||
            hasInvalidatedAJob
        ) {
          if (job.status !== 'pending') {
            job.status = 'pending';
            hasInvalidatedAJob = true;
          }
        }
      }
    }));
    return hasInvalidatedAJob;
  }
}));

module.exports = pipelineStore;
