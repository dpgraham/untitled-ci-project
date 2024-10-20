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
    jobs: state.jobs.map(job => ({ ...job, status: 'pending' })), // Update job statuses to 'pending'
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
  setJobStatus: (job, status) => set((state) => {
    const updatedJobs = state.jobs.map(otherJob => 
      otherJob.name === job.name ? { ...job, status } : otherJob // Update status if name matches
    );
    return { jobs: updatedJobs };
  }),
  getNextJob: () => {
    return pipelineStore.getState().jobs.find(job => job.status === 'pending'); // Find the first pending job
  },
  resetJobs: (filepath) => set((state) => {
    return produce(state, draft => {
      let hasInvalidatedAJob = false;
      for (const job of draft.jobs) {
        if (
          !job.onFilesChanged ||
          picomatch(job.onFilesChanged)(filepath) ||
          hasInvalidatedAJob
        ) {
          job.status = 'pending';
          hasInvalidatedAJob = true;
        }
      }
    });
  })
}));

module.exports = pipelineStore;
