const path = require('path');
const DockerExecutor = require('./executors/docker');
const pipelineStore = require('./pipeline.store');
const { Command } = require('commander');
const chokidar = require('chokidar');
const fs = require('fs');
const importFresh = require('import-fresh');
const debounce = require('lodash.debounce');
const { getFiles, shouldIgnoreFilepath } = require('./utils');
const { getLogger } = require('./logger');
require('colors');

const { JOB_STATUS, PIPELINE_STATUS } = pipelineStore;

// Pipeline definition functions
global.image = (imageName) => {
  pipelineStore.getState().setImage(imageName);
};

let currentJob = null;

global.job = (name, fn) => {
  const jobDef = { name, steps: [], onFilesChanged: null };
  currentJob = pipelineStore.getState().addJob({...jobDef, status: JOB_STATUS.PENDING});
  fn(jobDef);
  currentJob = null;
};

global.env = (name, value) => {
  pipelineStore.getState().setEnv(name, value, currentJob);
};

global.secret = (name, value) => {
  pipelineStore.getState().setEnv(name, value, currentJob, true);
};

global.step = (command) => {
  pipelineStore.getState().addStep({ command });
};

global.files = (globPattern) => {
  pipelineStore.getState().setFiles(globPattern);
};

global.ignore = (...patterns) => {
  pipelineStore.getState().addIgnorePatterns(patterns);
};

global.output = (dir) => {
  const state = pipelineStore.getState();
  state.setOutputDir(dir);
  state.addIgnorePatterns([dir]);
};

global.concurrency = (concurrency) => {
  pipelineStore.getState().setMaxConcurrency(concurrency);
};

global.workdir = (workdir) => {
  pipelineStore.getState().setWorkDir(workdir);
};

global.onFilesChanged = (pattern) => {
  pipelineStore.getState().setOnFilesChanged(pattern);
};

global.group = (name) => {
  pipelineStore.getState().setGroup(name);
};

const logger = getLogger();

function buildPipeline (pipelineFile) {
  // Clear previous definitions
  pipelineStore.getState().reset();
  pipelineStore.getState().setPipelineFile(pipelineFile);

  // Load and execute the pipeline definition
  try {
    importFresh(pipelineFile);
  } catch (e) {
    logger.error(`Pipeline is invalid. Syntax error: ${e.stack}`.red);
    return new Error(`invalid pipeline`);
  }

  pipelineStore.getState().validatePipeline();
  const { isInvalidPipeline, invalidReason } = pipelineStore.getState();
  if (isInvalidPipeline) {
    logger.error(invalidReason.red);
    return new Error('invalid pipeline');
  }

  const { image: currentImage } = pipelineStore.getState();

  // Default to Alpine if no image is specified
  if (!currentImage) {
    pipelineStore.getState().setImage('alpine:latest');
    logger.warn('No image specified in the pipeline. Defaulting to alpine:latest'.yellow);
  }
}

async function buildExecutor (pipelineFile) {
  const { image: currentImage, files, ignorePatterns } = pipelineStore.getState();

  // Get the directory of the pipeline file
  const pipelineDir = path.dirname(pipelineFile);
  const workdir = pipelineStore.getState().workDir;

  try {
    let executor = new DockerExecutor();
    await executor.start(currentImage, workdir);

    // Copy files matching the glob pattern to the container
    if (files) {
      let filesArr = getFiles(files, pipelineDir, ignorePatterns);
      const filesToCopy = filesArr.map((file) => ({
        source: path.join(pipelineDir, file),
        target: path.join(workdir, file),
      }));
      await executor.copyFiles(filesToCopy);
    }
    return executor;
  } catch (err) {
    logger.error('Failed to start the container or copy files. Please check your Docker installation and permissions.'.red);
    throw err;
  }
}

const logStreams = {};

function printJobInfo (nextJobs) {
  const jobNames = nextJobs.map(({name}) => name);
  if (jobNames.length > 1) {
    logger.info(`Running ${jobNames.length} jobs concurrently: '${jobNames.join('\', \'')}'`.blue);
  } else if (jobNames.length === 1) {
    logger.info(`Running job: '${jobNames[0]}'`.blue);
  }
}

async function runJob (executor, job) {
  const state = pipelineStore.getState();
  const { outputDir } = state;
  const logFilePath = path.join(outputDir, 'jobs', `${job.name}.log`);
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
  try {
    const opts = {
      // if the job is part of a "group" we need to clone the executor so
      // that it can be run in parallel
      clone: !!job.group,
      env: state.getEnv(job),
      secrets: state.getSecrets(job),
    };
    exitCode = await executor.run(commands, logStream, opts);
    if (exitCode !== 0) {
      // TODO: add emoji prefixes to all of the loggers to make it more colorful
      logger.info(`Job '${job.name}' failed with exit code: ${exitCode}`.red); // Log failure
    } else {
      logger.info(`Job '${job.name}' passed.`.green);
    }
  } catch (err) {
    if (err.isKilled) {
      return;
    }
  }

  // TODO: Handle a case where when the pipeline exits, the containers are all shutdown

  logStream.end(); // Close the log stream
  pipelineStore.getState().setJobStatus(job, exitCode === 0 ? JOB_STATUS.PASSED : JOB_STATUS.FAILED);

  const pipelineStatus = pipelineStore.getState().getPipelineStatus();

  // if the pipeline is complete, log message and don't dequeue any more jobs
  if ([PIPELINE_STATUS.PASSED, PIPELINE_STATUS.FAILED].includes(pipelineStatus)) {
    if (pipelineStatus === PIPELINE_STATUS.PASSED) {
      logger.info(`\nPipeline is passing`.green);
    } else {
      logger.error(`\nPipeline is failing`.red);
    }
    if (executor.exitOnDone) {
      process.exit(exitCode);
    }
    // TODO: use an NPM package that accepts user input. One that
    // makes it so you don't need to push enter
    logger.info('\nPress "q" and Enter to quit the pipeline.'.gray);
    return;
  }

  // TODO: pipelinStore.getState().setJobResult() <-- sets reason why job failed, if it did
  pipelineStore.getState().enqueueJobs();
  const nextJobs = pipelineStore.getState().dequeueNextJobs();

  // print message indicating job(s) is/are running
  printJobInfo(nextJobs);

  // run the jobs
  if (nextJobs.length > 0) {
    for (const nextJob of nextJobs) {
      runJob(executor, nextJob);
    }
  }
}

async function restartJobs (executor, filePath) {
  const hasInvalidatedAJob = pipelineStore.getState().resetJobs(filePath);
  if (hasInvalidatedAJob) {
    logger.info(`${filePath} changed. Re-running pipeline.`.gray);
    debouncedRunNextJobs.cancel();
    await executor.stopExec();
    await debouncedRunNextJobs(executor);
  }
}

async function runNextJobs (executor) {
  pipelineStore.getState().enqueueJobs();
  const nextJobs = pipelineStore.getState().dequeueNextJobs();
  // print message indicating job(s) is/are running
  printJobInfo(nextJobs);

  for await (const nextJob of nextJobs) {
    await runJob(executor, nextJob);
  }
}

const DEBOUNCE_MINIMUM = 2 * 1000; // 2 seconds

const debouncedRunNextJobs = debounce(runNextJobs, DEBOUNCE_MINIMUM);

// Main execution
if (require.main === module) {
  const program = new Command();

  program
    .name('pipeline-runner')
    .description('Run a pipeline')
    .argument('<file>', 'Path to the pipeline file')
    .option('--ci', 'Exit immediately when the job is done')
    .action(async (file) => {
      const pipelineFile = path.resolve(process.cwd(), file);
      let executor;

      const runAndWatchPipeline = async () => {
        try {
          const { outputDir } = pipelineStore.getState();
          const logDir = path.join(outputDir, 'jobs');
          logger.info(`Running pipeline. Outputting results to '${outputDir}'`.blue);
          if (fs.existsSync(logDir)) {
            const files = fs.readdirSync(logDir);
            for (const file of files) {
              await fs.promises.rm(path.join(logDir, file), { recursive: true, force: true });
            }
          }
          await runNextJobs(executor);
        } catch (error) {
          logger.error(`Pipeline execution failed`.red);
          logger.error(error);
          if (executor) {
            await executor.stop();
          }
          process.exit(1);
        }
      };

      const err = buildPipeline(pipelineFile);
      if (err) {
        return;
      }
      executor = await buildExecutor(pipelineFile);
      executor.exitOnDone = program.opts().ci || process.env.CI;

      // Watch for file changes

      // Initial run
      runAndWatchPipeline();
      const pipelineDir = path.dirname(pipelineFile);
      const { ignorePatterns, files } = pipelineStore.getState();

      // watch files changed
      const watcher = chokidar.watch(files, {
        persistent: true,
        cwd: pipelineDir,
        ignored (filepath) {
          if (path.isAbsolute(filepath)) {
            filepath = path.relative(pipelineDir, filepath);
          }
          return shouldIgnoreFilepath(filepath, ignorePatterns);
        }
      });

      watcher.on('change', async (filePath) => {
        const { workDir } = pipelineStore.getState();
        filePath = path.isAbsolute(filePath) ? path.relative(path.dirname(pipelineFile), filePath) : filePath;
        await executor.copyFiles([
          {
            source: path.join(path.dirname(pipelineFile), filePath),
            target: path.join(workDir, path.normalize(filePath)),
          },
        ]);
        restartJobs(executor, filePath);
      });

      watcher.on('unlink', async (filePath) => {
        filePath = path.isAbsolute(filePath) ? path.relative(path.dirname(pipelineFile), filePath) : filePath;
        const { workDir } = pipelineStore.getState();
        await executor.deleteFiles([{
          target: path.join(workDir, path.normalize(filePath)),
        }]);
        restartJobs(executor, filePath);
      });

      // watch the pipeline file
      const pipelineFileWatcher = chokidar.watch(pipelineFile, {
        persistent: true,
        cwd: pipelineDir,
      });

      pipelineFileWatcher.on('change', async () => {
        logger.info(`\nYou changed the pipeline file '${path.basename(pipelineFile)}'. Re-starting...`.gray);
        debouncedRunNextJobs.cancel();
        await executor.stopExec();
        const err = buildPipeline(pipelineFile);
        if (err) {
          return;
        }
        await debouncedRunNextJobs(executor);
      });

      pipelineFileWatcher.on('unlink', () => {
        logger.info(`You deleted the pipeline file '${path.basename(pipelineFile)}'. Exiting.`.gray);
        process.exit(0);
      });

      // Set up readline interface for user input
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      readline.on('line', async (input) => {
        if (input.toLowerCase() === 'q') {
          logger.info('Stopping executor and exiting pipeline...'.gray);
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
