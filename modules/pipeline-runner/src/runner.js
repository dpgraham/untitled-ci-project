const path = require('path');
const DockerExecutor = require('./executors/docker');
const pipelineStore = require('./pipeline.store');
const { Command } = require('commander');
const chokidar = require('chokidar');
const fs = require('fs');
const debounce = require('lodash.debounce');
const picomatch = require('picomatch');
const { getFiles } = require('./utils');

const { JOB_STATUS, PIPELINE_STATUS } = pipelineStore;

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
      const filesToCopy = filesArr.map((file) => ({
        source: file,
        target: path.join(destPath, path.relative(pipelineDir, file)),
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

  // group the steps into one array of commands
  const commands = [];
  for (const step of job.steps) {
    commands.push(step.command);
  }

  let exitCode;
  console.log(`Running job: ${job.name}`);
  try {
    exitCode = await executor.run(commands, logStream);
    if (exitCode !== 0) {
      console.log(`Job ${job.name} failed with exit code: ${exitCode}\n`); // Log failure
    } else {
      console.log(`Job ${job.name} passed.`);
    }
  } catch (error) {
    console.log(`Error executing job: ${job.name}\nError details: ${error}\n`); // Log error
    exitCode = 1;
  }

  logStream.end(); // Close the log stream
  pipelineStore.getState().setJobStatus(job, exitCode === 0 ? JOB_STATUS.PASSED : JOB_STATUS.FAILED);

  const pipelineStatus = pipelineStore.getState().getPipelineStatus();

  // if the pipeline is complete, log message and don't dequeue any more jobs
  if ([PIPELINE_STATUS.PASSED, PIPELINE_STATUS.FAILED].includes(pipelineStatus)) {
    console.log(`Pipeline is ${pipelineStatus === PIPELINE_STATUS.PASSED ? 'passing' : 'failing'}`);
    if (executor.exitOnDone) {
      process.exit(exitCode);
    }
    console.log('Press "q" and Enter to quit the pipeline.');
    return;
  }

  // TODO: pipelinStore.getState().setJobResult() <-- sets reason why job failed, if it did
  pipelineStore.getState().enqueueJobs();
  const nextJobs = pipelineStore.getState().dequeueNextJobs();
  if (nextJobs.length > 0) {
    for (const nextJob of nextJobs) {
      runJob(executor, nextJob);
    }
  }
}

const DEBOUNCE_MINIMUM = 2 * 1000; // 2 seconds

const debouncedRunJob = debounce(runJob, DEBOUNCE_MINIMUM);

async function restartJobs (executor, filePath) {
  const hasInvalidatedAJob = pipelineStore.getState().resetJobs(filePath);
  if (hasInvalidatedAJob) {
    await executor.stopExec();
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
      executor.exitOnDone = program.opts().ci || process.env.CI;

      // Watch for file changes

      // Initial run
      runAndWatchPipeline();
      const pipelineDir = path.dirname(pipelineFile);
      const ignorePatterns = pipelineStore.getState().ignorePatterns;
      const filesArr = getFiles(pipelineStore.getState().files, pipelineDir, ignorePatterns);
      // TODO: FIx bug where chokidar.watch is watching more than just "filesArr"
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

      // TODO: watch the pipeline file here too and have it restart the whole thing when it changes
      // or tell user to close and re-run

      watcher.on('change', async (filePath) => {
        // TODO: have it delete files here too
        filePath = path.isAbsolute(filePath) ? path.relative(path.dirname(pipelineFile), filePath) : filePath;
        await executor.copyFiles([
          {
            source: path.join(path.dirname(pipelineFile), filePath),
            // TODO: Change /app to not hardcoded
            target: path.join('/app', path.normalize(filePath)),
          },
        ]);
        restartJobs(executor, filePath);
      });

      // TODO: Handle case where a file is restored

      // Add event listener for deleted files
      watcher.on('unlink', async (filePath) => {
        filePath = path.isAbsolute(filePath) ? path.relative(path.dirname(pipelineFile), filePath) : filePath;
        await executor.deleteFiles([{
          // TODO: Change /app to not hardcoded
          target: path.join('/app', path.normalize(filePath)),
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
