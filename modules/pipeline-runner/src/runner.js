const path = require('path');
const glob = require('glob');
const DockerExecutor = require('./executors/docker');
const pipelineStore = require('./pipeline.store');

// Pipeline definition functions
global.image = (imageName) => {
  pipelineStore.getState().setImage(imageName);
};

global.job = (name, fn) => {
  const jobDef = { name, steps: [] };
  pipelineStore.getState().addJob(jobDef);
  fn(jobDef);
};

global.step = (command) => {
  const state = pipelineStore.getState();
  const jobs = state.jobs;
  if (jobs.length === 0) {
    throw new Error('Steps cannot be set outside of a job');
  }
  const currentJob = jobs[jobs.length - 1];
  currentJob.steps = currentJob.steps || [];
  currentJob.steps.push({ command });
  pipelineStore.setState({ jobs });
};

global.files = (globPattern) => {
  pipelineStore.getState().setCurrentFiles(globPattern);
};

global.ignore = (...patterns) => {
  pipelineStore.getState().addIgnorePatterns(patterns);
};

async function runPipeline(pipelineFile) {
  // Clear previous definitions
  pipelineStore.getState().reset();

  // Load and execute the pipeline definition
  require(pipelineFile);

  const { image: currentImage, currentFiles, ignorePatterns } = pipelineStore.getState();

  // Default to Alpine if no image is specified
  if (!currentImage) {
    pipelineStore.getState().setImage('alpine:latest');
    console.warn('No image specified in the pipeline. Defaulting to alpine:latest');
  }

  // Get the directory of the pipeline file
  const pipelineDir = path.dirname(pipelineFile);

  const executor = new DockerExecutor();
  try {
    await executor.start(currentImage, '/app');

    // Copy files matching the glob pattern to the container
    if (currentFiles) {
      const destPath = '/app';
      const files = glob.sync(currentFiles, { 
        nodir: true,
        ignore: ignorePatterns,
        dot: true,
        recursive: true,
        cwd: pipelineDir,
      });
      const filesToCopy = files.map(file => ({
        source: path.resolve(pipelineDir, file),
        target: path.posix.join(destPath, path.relative(pipelineDir, file)),
      }));
      await executor.copyFiles(filesToCopy, destPath);
    }
  } catch (err) {
    console.error('Failed to start the container or copy files. Please check your Docker installation and permissions.');
    throw err;
  }

  let i = 0;
  let allJobsPassed = true;
  try {
    // Run jobs and stages in the order they were defined
    const jobs = pipelineStore.getState().jobs;
    for (const job of jobs) {
      const exitCode = await runJob(executor, job);
      pipelineStore.getState().setJobExitCode(i, exitCode);
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
    const jobs = pipelineStore.getState().jobs;
    if (jobs.length > 0) {
      pipelineStore.getState().setJobExitCode(i, 1);
    }
    allJobsPassed = false;
  } finally {
    // Set the overall pipeline status
    pipelineStore.getState().setStatus(allJobsPassed ? 'passed' : 'failed');
    await executor.stop();
  }
}

async function runJob(executor, job) {
  console.log(`Running job: ${job.name}`);
  for (const step of job.steps) {
    try {
      const exitCode = await executor.runStep(step);
      if (exitCode !== 0) {
        console.error(`Step failed with exit code: ${exitCode}`);
        return exitCode;
      }
    } catch (error) {
      console.error(`Error executing step: ${step.command}`);
      console.error(`Error details: ${error}`);
      return 1;
    }
  }
  
  console.log(`Job '${job.name}' finished successfully`);
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
