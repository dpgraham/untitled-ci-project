#!/usr/bin/env node
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
const apiNamespace = require('./api-namespace');
require('colors');
const Handlebars = require('handlebars');
const { select } = require('@inquirer/prompts');
const pipelineHelpers = require('./pipeline-helpers');
const { run: runVisualizer } = require('./server');

const { JOB_STATUS, JOB_RESULT, PIPELINE_STATUS } = pipelineStore;

const logger = getLogger();

async function buildPipeline (pipelineFile) {
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

  // close any open log streams
  for (const logStream of Object.keys(logStreams)) {
    logStreams[logStream].end();
    delete logStreams[logStream];
  }

  pipelineStore.getState().validatePipeline();
  pipelineStore.getState().setLogfilePaths();
  const { isInvalidPipeline, invalidReason } = pipelineStore.getState();
  if (isInvalidPipeline) {
    logger.error(invalidReason.red);
    return new Error('invalid pipeline');
  }

  // clear output directories
  const { outputDir } = pipelineStore.getState();
  try {
    await fs.promises.rm(outputDir, { force: true, recursive: true });
  } catch (e) {
    logger.error(`Failed to delete ${outputDir}`);
  }

  // write all of the logfiles as empty files
  await writeLogFiles(pipelineStore.getState().jobs);

  const { image: currentImage } = pipelineStore.getState();

  // Default to Alpine if no image is specified
  if (!currentImage) {
    pipelineStore.getState().setImage('alpine:latest');
    logger.warn('No image specified in the pipeline. Defaulting to alpine:latest'.yellow);
  }
}

/**
 * creates log file for each job, if file already exists
 * it empties the file
 * @param {*} jobs
 */
async function writeLogFiles (jobs) {
  // write all of the logfiles as empty files
  const fileWritePromises = [];
  for (const job of jobs) {
    fileWritePromises.push((async () => {
      const jobDir = path.dirname(job.logFilePath);
      await fs.promises.mkdir(jobDir, { recursive: true });
      return await fs.promises.writeFile(job.logFilePath, '', { flag: 'w' });
    })());
  }
  await Promise.all(fileWritePromises);
}

async function buildExecutor (pipelineFile) {
  const { image: currentImage, files, ignorePatterns } = pipelineStore.getState();

  // Get the directory of the pipeline file
  const pipelineDir = path.dirname(pipelineFile);
  const workdir = pipelineStore.getState().workDir;
  const name = path.basename(pipelineFile);

  try {
    let executor = new DockerExecutor();

    process.on('SIGINT', () => {
      // TODO: 1 set state here to indicate that it was aborted
      logger.info('Terminating pipeline'.gray);
      executor.abort();
      if (require.main === module) { process.exit(1); }
    });
    await executor.start({image: currentImage, workingDir: workdir, name });

    // Copy files matching the glob pattern to the container
    if (files) {
      let filesArr = getFiles(files, pipelineDir, ignorePatterns);
      const filesToCopy = filesArr.map((file) => ({
        source: path.join(pipelineDir, file),
        target: path.join(workdir, path.relative(files, file)),
      }));
      await executor.copyFiles(filesToCopy);
    }
    return executor;
  } catch (err) {
    logger.error('Failed to start the container or copy files. Please check your Docker installation and permissions.'.red);
    throw err;
  }
}

// TODO: 0 ... close all log streams when the pipeline is done
const logStreams = {};
let selectPromise;

function printJobInfo (nextJobs) {
  const jobNames = nextJobs.map(({name}) => name);
  if (jobNames.length > 1) {
    logger.info(`Running ${jobNames.length} jobs concurrently: '${jobNames.join('\', \'')}'`.blue);
  } else if (jobNames.length === 1) {
    logger.info(`Running job: '${jobNames[0]}'`.blue);
  }
  // TODO: when a job is running, show dot indicator for progress + prevent timeouts
}

async function runJob (executor, job) {
  const state = pipelineStore.getState();
  const { outputDir } = state;
  const { logFilePath } = job;

  // set the job ID
  pipelineStore.getState().setJobId(job);

  let artifactsPathDest;
  if (job.artifactsDir) {
    artifactsPathDest = path.join(outputDir, 'jobs', job.name, 'artifacts');
    if (fs.existsSync(artifactsPathDest)) {
      await fs.promises.rm(artifactsPathDest, { recursive: true, force: true });
    }
    await fs.promises.mkdir(artifactsPathDest, { recursive: true });
  }
  // TODO: delete log streams before exiting process
  // TODO: re-use log streams instead of closing them
  if (logStreams[logFilePath]) {
    logStreams[logFilePath].end();
    delete logStreams[logFilePath];
  }
  await fs.promises.writeFile(logFilePath, '');
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' }); // Create a writable stream to the log file
  logStreams[logFilePath] = logStream;

  // group the steps into one array of commands
  const commands = [];
  const output = pipelineStore.getState().getJobOutputs();
  for (const step of job.steps) {
    commands.push(Handlebars.compile(step.command)({ output }));
  }

  let exitCode;
  try {
    const opts = {
      // if the job is part of a "group" we need to clone the executor so
      // that it can be run in parallel
      clone: !!job.group,
      env: state.getEnv(job),
      secrets: state.getSecrets(job),
      name: job.name,
      image: job.image,
      copy: job.copy,
      artifactsDirSrc: job.artifactsDir,
      artifactsDirDest: artifactsPathDest,
    };
    const runOutput = await executor.run(commands, logStream, opts);
    exitCode = runOutput.exitCode;
    if (exitCode !== 0) {
      // TODO: add emoji prefixes to all of the loggers to make it more colorful
      logger.info(`Job '${job.name}' failed with exit code: ${exitCode}`.red); // Log failure
    } else {
      if (runOutput.output) {
        pipelineStore.getState().setJobOutput(runOutput.output, job);
      }
      logger.info(`Job '${job.name}' passed.`.green);
    }
  } catch (err) {
    if (err.isKilled) {
      return;
    }
    logger.error('Uncaught error:', err);
  }

  logStream.end(); // Close the log stream
  pipelineStore.getState().setJobStatus(job, exitCode === 0 ? JOB_STATUS.PASSED : JOB_STATUS.FAILED);

  const pipelineStatus = pipelineStore.getState().getPipelineStatus();

  // TODO: add a fail strategy option that kills a group once just one has failed

  // if the pipeline is complete, log message and don't dequeue any more jobs
  if ([PIPELINE_STATUS.PASSED, PIPELINE_STATUS.FAILED].includes(pipelineStatus)) {
    if (pipelineStatus === PIPELINE_STATUS.PASSED) {
      pipelineStore.getState().setPipelineResult(JOB_RESULT.PASSED);
      logger.info(`\nPipeline is passing\n`.green);
    } else {
      pipelineStore.getState().setPipelineResult(JOB_RESULT.FAILED);
      logger.error(`\nPipeline is failing\n`.red);
    }
    if (pipelineStore.getState().exitOnDone) {
      await executor.stopExec();
      if (require.main === module) {
        process.exit(exitCode);
      }
    }
    if (require.main !== module) {
      await executor?.stop();
    } else {
      if (selectPromise) {
        selectPromise.cancel();
      }
      selectPromise = select({
        message: 'Select next action',
        choices: [
          { name: 'quit', value: 'quit', description: 'Exit pipeline' },
          // { name: 're-run', value: 'rerun', description: 'Re-run pipeline from beginning' },
        ],
      });
      try {
        const selection = await selectPromise;
        if (selection === 'quit') {
          logger.info('Stopping executor and exiting pipeline...'.gray);
          await executor?.stop();
          if (require.main === module) { process.exit(0); }
        }
      } catch (e) {
        // prompt was cancelled if we reach here. do nothing.
      }
    }
    return;
  }

  await runNextJobs(executor);
}

async function restartJobs (executor, filePath) {
  const invalidatedJobs = pipelineStore.getState().resetJobs(filePath);
  if (invalidatedJobs.length > 0) {
    logger.info(`\n${filePath} changed. Re-running pipeline.`.gray);
  }

  // kill all jobs that have been invalidated
  const promises = [];
  for (const invalidatedJob of invalidatedJobs) {
    promises.push(executor.stopExec(invalidatedJob));
  }
  await Promise.all(promises);

  // queue up and start running next jobs
  const hasInvalidatedAJob = invalidatedJobs.length > 0;
  if (hasInvalidatedAJob) {
    pipelineStore.getState().enqueueJobs();
    debouncedRunNextJobs.cancel();
    await debouncedRunNextJobs(executor);
  }
}

async function runNextJobs (executor) {
  selectPromise?.cancel();
  pipelineStore.getState().enqueueJobs();
  const nextJobs = pipelineStore.getState().dequeueNextJobs();

  // print message indicating job(s) is/are running
  printJobInfo(nextJobs);

  const jobs = [];
  for (const nextJob of nextJobs) {
    jobs.push(runJob(executor, nextJob));
  }
  await Promise.all(jobs);
}

const DEBOUNCE_MINIMUM = 2 * 1000; // 2 seconds

const debouncedRunNextJobs = debounce(runNextJobs, DEBOUNCE_MINIMUM);

async function run ({ file, opts }) {
  const pipelineFile = path.resolve(process.cwd(), file);
  let executor;

  // add the workflow syntax (image, job, etc...) to global namespace unless user opts-out
  if (!opts.noGlobalVariables) {
    for (const key of Object.keys(apiNamespace)) {
      global[key] = apiNamespace[key];
    }
    global.helpers = {};
    for (const key of Object.keys(pipelineHelpers)) {
      global.helpers[key] = pipelineHelpers[key];
    }
  }

  const runAndWatchPipeline = async () => {
    try {
      const { outputDir } = pipelineStore.getState();
      logger.info(`Running pipeline. Outputting results to '${outputDir}'`.blue);
      await fs.promises.rm(outputDir, { recursive: true, force: true });

      // write all of the logfiles as empty files
      await writeLogFiles(pipelineStore.getState().jobs);

      await runNextJobs(executor);
    } catch (error) {
      logger.error(`Pipeline execution failed`.red);
      logger.error(error);
      if (executor) {
        await executor.stop();
      }
      if (require.main === module) {process.exit(1);}
    }
  };

  const err = await buildPipeline(pipelineFile);
  if (err) {
    return;
  }
  executor = await buildExecutor(pipelineFile);
  pipelineStore.getState().setExitOnDone(!!(opts.ci || process.env.CI));

  if (!pipelineStore.getState().exitOnDone) {
    await runVisualizer();
  }

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
      if (filepath === path.relative(pipelineDir, pipelineFile)) {
        return true;
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
        target: path.join(workDir, path.relative(files, filePath)),
      },
    ]);
    restartJobs(executor, filePath);
  });

  watcher.on('unlink', async (filePath) => {
    filePath = path.isAbsolute(filePath) ? path.relative(path.dirname(pipelineFile), filePath) : filePath;
    const { workDir } = pipelineStore.getState();
    await executor.deleteFiles([{
      target: path.join(workDir, path.relative(files, filePath)),
    }]);
    restartJobs(executor, filePath);
  });

  // watch the pipeline file
  const pipelineFileWatcher = chokidar.watch(pipelineFile, {
    persistent: true,
    cwd: pipelineDir,
  });

  pipelineFileWatcher.on('change', async () => {
    selectPromise?.cancel();
    logger.info(`\nYou changed the pipeline file '${path.basename(pipelineFile)}'. Re-starting...`.gray);
    debouncedRunNextJobs.cancel();
    await executor.stopExec();
    const err = await buildPipeline(pipelineFile);
    if (err) {
      return;
    }
    await debouncedRunNextJobs(executor);
  });

  pipelineFileWatcher.on('unlink', () => {
    logger.info(`You deleted the pipeline file '${path.basename(pipelineFile)}'. Exiting.`.gray);
    if (require.main === module) {process.exit(1);}
  });

  if (require.main !== module) {
    await new Promise((resolve, reject) => {
      pipelineStore.subscribe((state) => {
        const pipelineStatus = state.getPipelineStatus();
        if (pipelineStatus === PIPELINE_STATUS.PASSED) {
          executor.stopExec().then(resolve);
        } else if (pipelineStatus === PIPELINE_STATUS.FAILED) {
          executor.stopExec().then(reject);
        }
      });
    });
  }
}

// Main execution
function main () {
  const program = new Command();

  program
    .name('pipeline-runner')
    .description('Run a pipeline')
    .argument('<file>', 'Path to the pipeline file')
    .option('--ci', 'Exit immediately when the job is done')
    // TODO: .option('--version', 'Print the version of Carry-On')
    .option('--no-global-variables', 'Do not make Carry-On variables available in global namespace')
    .action((file) => run({ file, opts: program.opts() }));

  program.parse(process.argv);
}

if (require.main === module) {
  main();
}

module.exports = { run, ...pipelineHelpers };
