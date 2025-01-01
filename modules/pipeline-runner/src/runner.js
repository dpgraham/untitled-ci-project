const path = require('path');
const DockerExecutor = require('./executors/docker');
const pipelineStore = require('./pipeline.store');
const { Command } = require('commander');
const chokidar = require('chokidar');
const fs = require('fs');
const debounce = require('lodash.debounce');
const picomatch = require('picomatch');
const { getFiles } = require('./utils');

const { JOB_STATUS } = pipelineStore;

// Pipeline definition functions
global.image = (imageName) => {
  pipelineStore.getState().setImage(imageName);
};

global.job = (name, fn) => {
  // TODO: Forbid duplicate names
  const jobDef = { name, steps: [], onFilesChanged: null }; // Add onFilesChanged attribute
  pipelineStore.getState().addJob({...jobDef, status: JOB_STATUS.PENDING});
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

global.group = (name) => {
  const state = pipelineStore.getState();
  const jobs = state.jobs;
  if (jobs.length === 0) {
    throw new Error('onFilesChanged cannot be set outside of a job');
  }
  const currentJob = jobs[jobs.length - 1];
  currentJob.group = name;
  pipelineStore.setState({ jobs });
};

// TODO: Add something here to sort the jobs so groups stay together

async function buildPipeline (pipelineFile) {
  // Clear previous definitions
  pipelineStore.getState().reset();
  pipelineStore.getState().setPipelineFile(pipelineFile);

  // Load and execute the pipeline definition
  require(pipelineFile);

  // Sort the jobs based on their grouping
  pipelineStore.getState().sortJobs();

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
      const destPath = '/app'; // TODO: Make the desPath configurable and not hardcoded
      let filesArr = getFiles(files, pipelineDir, ignorePatterns);
      filesArr = filesArr.filter((file) =>
        // TODO: Fix picomatch here
        !ignorePatterns.some((pattern) => picomatch(pattern, { dot: true })(file)) && fs.statSync(file).isFile()
      );
      const filesToCopy = filesArr.map((file) => ({
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

function runPipeline (executor) {
  pipelineStore.getState().enqueueJobs();
  const nextJobs = pipelineStore.getState().dequeueNextJobs();
  for (const nextJob of nextJobs) {
    runJob(executor, nextJob);
  }

  // Return the executor so it can be stopped later
  return executor;
}

const logStreams = {};

async function runJob (executor, job) {
  // TODO: make "ci-output" configurable
  const logFilePath = `ci-output/jobs/${job.name}.log`; // Define the log file path
  if (fs.existsSync(logFilePath)) {
    await fs.promises.rm(logFilePath);
  }
  if (!fs.existsSync(path.dirname(logFilePath))) {
    await fs.promises.mkdir(path.dirname(logFilePath), { recursive: true });
  }
  pipelineStore.getState().setJobFilePath(job, logFilePath);
  if (logStreams[logFilePath]) {
    logStreams[logFilePath].end();
    delete logStreams[logFilePath];
  }
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' }); // Create a writable stream to the log file
  logStreams[logFilePath] = logStream;

  console.log(`Running job: ${job.name}`);
  let exitCode;
  for (const step of job.steps) {
    try {
      exitCode = await executor.runStep(step, logStream);
      console.log(`Step: ${step.command}\nExit Code: ${exitCode}\n`); // Log step output
      if (exitCode !== 0) {
        console.log(`Step failed with exit code: ${exitCode}\n`); // Log failure
        break;
      }
    } catch (error) {
      console.log(`Error executing step: ${step.command}\nError details: ${error}\n`); // Log error
      exitCode = 1;
      break;
    }
  }
  logStream.end(); // Close the log stream
  pipelineStore.getState().setJobStatus(job, exitCode === 0 ? JOB_STATUS.PASSED : JOB_STATUS.FAILED);
  // TODO: pipelinStore.getState().setJobResult() <-- sets reason why job failed, if it did
  pipelineStore.getState().enqueueJobs();
  const nextJobs = pipelineStore.getState().dequeueNextJobs();
  if (nextJobs.length > 0) {
    for (const nextJob of nextJobs) {
      runJob(executor, nextJob);
    }
  } else {
    // TODO: Make a function in pipeline.store.js that checks the whole status of the pipeline
    // to see if it is passing or failing
    if (exitCode === 0) {
      console.log('Pipeline is passing');
    } else {
      console.log('Pipeline is failing');
    }
    if (executor.exitOnDone) {
      process.exit(exitCode);
    }
    console.log('Press "q" and Enter to quit the pipeline.');
  }
}

const DEBOUNCE_MINIMUM = 2 * 1000; // 2 seconds

const debouncedRunJob = debounce(runJob, DEBOUNCE_MINIMUM);

function restartJobs (executor, filePath) {
  const hasInvalidatedAJob = pipelineStore.getState().resetJobs(filePath);
  if (hasInvalidatedAJob) {
    pipelineStore.getState().enqueueJobs();
    const nextJobs = pipelineStore.getState().dequeueNextJobs();
    for (const nextJob of nextJobs) {
      console.log(`Re-running from job '${nextJob.name}'`);
      debouncedRunJob(executor, nextJob);
    }
  }
}

// Main execution
if (require.main === module) {
  const program = new Command();

  program
    .name('pipeline-runner')
    .description('Run a pipeline')
    .argument('<file>', 'Path to the pipeline file')
    .option('--ci', 'Exit immediately when the job is done')
    // TODO: Add max-concurrency as an option here
    .action(async (file) => {
      const pipelineFile = path.resolve(process.cwd(), file);
      let executor;

      const runAndWatchPipeline = async () => {
        try {
          // TODO: Make "ci-output" configurable
          const logDir = 'ci-output/jobs';
          if (fs.existsSync(logDir)) {
            const files = fs.readdirSync(logDir);
            for (const file of files) {
              await fs.promises.rm(path.join(logDir, file), { recursive: true, force: true });
            }
          }
          await runPipeline(executor);
        } catch (error) {
          console.error('Pipeline execution failed:', error);
          if (executor) {
            await executor.stop();
          }
          process.exit(1);
        }
      };

      executor = await buildPipeline(pipelineFile);
      executor.exitOnDone = program.opts().ci; // TODO: Make CI set to true when process.env.CI is true

      // Watch for file changes

      // Initial run
      runAndWatchPipeline();
      const pipelineDir = path.dirname(pipelineFile);
      const ignorePatterns = pipelineStore.getState().ignorePatterns;
      const filesArr = getFiles(pipelineStore.getState().files, pipelineDir, ignorePatterns);
      const watcher = chokidar.watch(filesArr, {
        persistent: true,
        ignored (filepath) {
          for (const pattern of ignorePatterns) {
            if (picomatch(pattern, { dot: true })(filepath)) {
              return true;
            }
          }
        }
      });

      watcher.on('change', async (filePath) => {
        // TODO: have it delete files here too
        await executor.stopExec();
        filePath = path.isAbsolute(filePath) ? path.relative(path.dirname(pipelineFile), filePath) : filePath;
        await executor.copyFiles([
          {
            source: path.join(path.dirname(pipelineFile), filePath),
            // TODO: Change /app to not hardcoded
            target: path.posix.join('/app', path.posix.normalize(filePath)),
          },
        ]);
        restartJobs(executor, filePath);
      });

      // TODO: Handle case where a file is restored
      // TODO: Move all "path.posix" into docker.js

      // Add event listener for deleted files
      watcher.on('unlink', async (filePath) => {
        filePath = path.isAbsolute(filePath) ? path.relative(path.dirname(pipelineFile), filePath) : filePath;
        await executor.deleteFiles([{
          // TODO: Change /app to not hardcoded
          target: path.posix.join('/app', path.posix.normalize(filePath)),
        }]);
        // Handle the deletion of the file (e.g., restart jobs or update state)
        await executor.stopExec();
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
