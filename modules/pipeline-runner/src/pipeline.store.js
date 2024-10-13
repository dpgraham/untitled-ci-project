const { create } = require('zustand');

const pipelineStore = create((set) => ({
  jobs: [],
  image: null,
  currentFiles: [],
  ignorePatterns: [],
  status: 'queued',
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
  setCurrentFiles: (files) => set({ currentFiles: files }),
  addIgnorePatterns: (patterns) => set((state) => ({ ignorePatterns: [...state.ignorePatterns, ...patterns] })),
  reset: () => set({ jobs: [], image: null, currentFiles: [], ignorePatterns: [], status: 'queued', result: 'in progress' }),
  setJobExitCode: (jobIndex, exitCode) => set((state) => {
    const updatedJobs = [...state.jobs];
    updatedJobs[jobIndex] = { ...updatedJobs[jobIndex], exitCode };
    return { jobs: updatedJobs };
  }),
  setStatus: (status) => set({ status }),
  setResult: (result) => set({ result }),
}));

module.exports = pipelineStore;