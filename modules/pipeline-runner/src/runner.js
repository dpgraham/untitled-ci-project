const path = require('path');
const glob = require('glob');
const DockerExecutor = require('./executors/docker');
const pipelineStore = require('./pipeline.store');
const { Command } = require('commander');
const chokidar = require('chokidar'); // Add chokidar library
const fs = require('fs'); // Add fs module
const { exec } = require('child_process');
const debounce = require('lodash.debounce');

// Pipeline definition functions
global.image = (imageName) => {
  pipelineStore.getState().setImage(imageName);
};

global.job = (name, fn) => {
  // TODO: Forbid duplicate names
  const jobDef = { name, steps: [], onFilesChanged: null }; // Add onFilesChanged attribute
  pipelineStore.getState().addJob({...jobDef, status: 'pending'});
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
  pipelineStore.getState().setFiles(globPattern);
};

global.ignore = (...patterns) => {
  pipelineStore.getState().addIgnorePatterns(patterns);
};

global.onFilesChanged = (pattern) => {
  const state = pipelineStore.getState();
  const jobs = state.jobs;
  if (jobs.length === 0) {
    throw new Error('onFilesChanged cannot be set outside of a job');
  }
  const currentJob = jobs[jobs.length - 1];
  currentJob.onFilesChanged = pattern; // Set the onFilesChanged attribute
  pipelineStore.setState({ jobs });
};

async function buildPipeline(pipelineFile) {
  // Clear previous definitions
  pipelineStore.getState().reset();
  pipelineStore.getState().setPipelineFile(pipelineFile);

  // Load and execute the pipeline definition
  require(pipelineFile);

  const { image: currentImage, files, ignorePatterns } = pipelineStore.getState();

  // Default to Alpine if no image is specified
  if (!currentImage) {
    pipelineStore.getState().setImage('alpine:latest');
    console.warn('No image specified in the pipeline. Defaulting to alpine:latest');
  }

  // Get the directory of the pipeline file
  const pipelineDir = path.dirname(pipelineFile);

  try {
    let executor = new DockerExecutor();
    await executor.start(currentImage, '/app');

    // Copy files matching the glob pattern to the container
    if (files) {
      const destPath = '/app';
      const files = fs.readdirSync(pipelineDir, { withFileTypes: true })
        .flatMap(dirent => {
          const res = path.resolve(pipelineDir, dirent.name);
          return dirent.isDirectory() ? 
            fs.readdirSync(res, { withFileTypes: true }).map(innerDirent => path.join(res, innerDirent.name)) : 
            res;
        })
        .filter(file => !ignorePatterns.some(pattern => file.includes(pattern)) && fs.statSync(file).isFile());
      const filesToCopy = files.map(file => ({
        source: path.resolve(pipelineDir, file),
        target: path.posix.join(destPath, path.relative(pipelineDir, file)),
      }));
      await executor.copyFiles(filesToCopy);
    }
    return executor;
  } catch (err) {
    console.error('Failed to start the container or copy files. Please check your Docker installation and permissions.');
    throw err;
  }
}

async function runPipeline(executor) {
  const nextJob = pipelineStore.getState().getNextJob();
  runJob(executor, nextJob);

  // Return the executor so it can be stopped later
  return executor;
}

async function runJob(executor, job) {
  console.log(`Running job: ${job.name}`);
  pipelineStore.getState().setStatus('running');
  let exitCode;
  for (const step of job.steps) {
    try {
      exitCode = await executor.runStep(step);
      if (exitCode !== 0) {
        console.error(`Step failed with exit code: ${exitCode}`);
        break;
      }
    } catch (error) {
      console.error(`Error executing step: ${step.command}`);
      console.error(`Error details: ${error}`);
      exitCode = 1;
      break;
    }
  }
  pipelineStore.getState().setJobStatus(job, exitCode === 0 ? 'passed' : 'failed');
  const nextJob = pipelineStore.getState().getNextJob();
  if (nextJob) {
    runJob(executor, nextJob);
  } else {
    console.log('pipeline is complete');
    console.log('Press "q" and Enter to quit the pipeline.');
    // TODO: check and set the pipeline's total status here
  }
}

const DEBOUNCE_MINIMUM = 2 * 1000; // 2 seconds

const debouncedRunJob = debounce(runJob, DEBOUNCE_MINIMUM);

// TODO: this should be selective based on files changed
async function restartJobs(executor, filePath) {
  // TODO: Make it so it only triggers if the filepath contents changed, not just CTRL+S
  pipelineStore.getState().resetJobs(filePath);
  const nextJob = pipelineStore.getState().getNextJob();
  debouncedRunJob(executor, nextJob);
}

// Main execution
if (require.main === module) {
  const program = new Command();

  program
    .name('pipeline-runner')
    .description('Run a pipeline')
    .argument('<file>', 'Path to the pipeline file')
    .action(async (file) => {
      const pipelineFile = path.resolve(process.cwd(), file);
      let executor;

      const runAndWatchPipeline = async () => {
        try {
          runPipeline(executor);
        } catch (error) {
          console.error('Pipeline execution failed:', error);
          if (executor) {
            await executor.stop();
          }
          process.exit(1);
        }
      };

      executor = await buildPipeline(pipelineFile);

      // Watch for file changes

      // Initial run
      runAndWatchPipeline();
      const watcher = chokidar.watch(pipelineStore.getState().files, { persistent: true });
      watcher.on('change', async (filePath) => {
        await executor.stopExec(); // TODO: Only stop if the current running job was invalidated
        restartJobs(executor, filePath);
      });
      
      // Set up readline interface for user input
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      readline.on('line', async (input) => {
        if (input.toLowerCase() === 'q') {
          console.log('Stopping executor and exiting pipeline...');
          if (executor) {
            await executor.stop();
          }
          readline.close();
          process.exit(0);
        }
      });

    });

  program.parse(process.argv);
}

module.exports = { runPipeline };
