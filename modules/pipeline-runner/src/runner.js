const { GenericContainer } = require('testcontainers');
const path = require('path');
const glob = require('glob');
const { create } = require('zustand');
const Docker = require("dockerode");

const docker = new Docker();

let pipeline = create((set) => ({
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

// Pipeline definition functions
global.image = (imageName) => {
  pipeline.getState().setImage(imageName);
};

global.job = (name, fn) => {
  const jobDef = { name, steps: [] };
  pipeline.getState().addJob(jobDef);
  fn(jobDef);
};

global.step = (command) => {
  const state = pipeline.getState();
  const jobs = state.jobs;
  if (jobs.length === 0) {
    throw new Error('Steps cannot be set outside of a job');
  }
  const currentJob = jobs[jobs.length - 1];
  currentJob.steps = currentJob.steps || [];
  currentJob.steps.push({ command });
  pipeline.setState({ jobs });
};

global.files = (globPattern) => {
  pipeline.getState().setCurrentFiles(globPattern);
};

global.ignore = (...patterns) => {
  pipeline.getState().addIgnorePatterns(patterns);
};

async function runPipeline(pipelineFile) {
  // Clear previous definitions
  pipeline.getState().reset();

  // Load and execute the pipeline definition
  require(pipelineFile);

  const { image: currentImage, currentFiles, ignorePatterns } = pipeline.getState();

  // Default to Alpine if no image is specified
  if (!currentImage) {
    pipeline.getState().setImage('alpine:latest');
    console.warn('No image specified in the pipeline. Defaulting to alpine:latest');
  }

  // Get the directory of the pipeline file
  const pipelineDir = path.dirname(pipelineFile);

  // Create base container
  let container;
  try {
    container = await new GenericContainer(currentImage)
      .withWorkingDir('/app')
      .withStartupTimeout(120000) // Increase timeout to 2 minutes
      .withPrivilegedMode(true) // Run in privileged mode
      .withCommand(["sh", "-c", "echo 'Container is ready' && tail -f /dev/null"])
      .start();
    
    console.log('Container is ready. Starting pipeline execution.');

     // Copy files matching the glob pattern to the container
     if (currentFiles) {
      const destPath = '/app';
      const files = glob.sync(currentFiles, { 
        nodir: true,
        ignore: ignorePatterns,
        dot: true,
        recursive: true,
        cwd: pipelineDir, // Set the current working directory for glob to the pipeline file's directory
      });
      for (const file of files) {
        const absolutePath = path.resolve(pipelineDir, file);
        const relativePath = path.relative(pipelineDir, absolutePath);
        const containerPath = path.posix.join(destPath, relativePath);
        await container.copyFilesToContainer([{
          source: absolutePath,
          target: containerPath,
        }]);
      }
    }
  } catch (err) {
    console.error('Failed to start the container or copy files. Please check your Docker installation and permissions.');
    throw err;
  }

  let i = 0;
  let allJobsPassed = true;
  try {
    // Run jobs and stages in the order they were defined
    const jobs = pipeline.getState().jobs;
    for (const job of jobs) {
      const exitCode = await runJob(container, job);
      pipeline.getState().setJobExitCode(i, exitCode);
      if (exitCode !== 0) {
        console.error(`Pipeline execution stopped due to job '${job.name}' failure.`);
        allJobsPassed = false;
        break; // Stop executing further jobs
      }
      i++;
    }
  } catch (e) {
    console.error('Failed ', e.message);
    // Set exitCode to 1 for the last job in case of unexpected errors
    const jobs = pipeline.getState().jobs;
    if (jobs.length > 0) {
      pipeline.getState().setJobExitCode(i, 1);
    }
    allJobsPassed = false;
  } finally {
    // Set the overall pipeline status
    pipeline.getState().setStatus(allJobsPassed ? 'passed' : 'failed');
    await container.stop();
  }
}

async function runJob(container, job) {
  console.log(`Running job: ${job.name}`);
  let exitCode;
  for (const step of job.steps) {
    try {
      console.log(`Executing step: ${step.command}`);
      const dockerContainer = docker.getContainer(container.getId());

      // Execute a command in the container, e.g., 'ls -l'
      const exec = await dockerContainer.exec({
        Cmd: ["sh", "-c", step.command],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });

      // Start the exec command with stream output
      const stream = await exec.start({ hijack: true, stdin: false });

      // Stream the output as it comes in
      docker.modem.demuxStream(stream, process.stdout, process.stderr);
      
      const promise = new Promise((resolve, reject) => {
        stream.on("end", async () => {
          const execInspect = await exec.inspect();
          exitCode = execInspect.ExitCode;
          if (exitCode === 0) resolve();
          else reject();
          resolve();
        });
      });

      await promise;

      if (exitCode !== 0) {
        console.error(`Step failed with exit code: ${exitCode}`);
        return exitCode;
      }
    } catch (error) {
      console.error(`Error executing step: ${step.command}`);
      console.error(`Error details: ${error.message}`);
      return 1;
    }
  }
  
  console.log(`Job '${job.name}' finished with exit code: ${exitCode}`);
  return 0;
}

// Main execution
if (require.main === module) {
  const pipelineFile = path.resolve(process.cwd(), process.argv[2]);
  if (!pipelineFile) {
    console.error('Please provide a pipeline file as an argument.');
    process.exit(1);
  }
  runPipeline(pipelineFile).catch(console.error);
}

module.exports = { runPipeline };
