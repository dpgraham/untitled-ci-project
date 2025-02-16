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

const logStreams = {};

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

  // close any already open log streams
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
  await createLogFiles(pipelineStore.getState().jobs);

  const { image: currentImage } = pipelineStore.getState();

  // Default to Alpine if no image is specified
  if (!currentImage) {
    pipelineStore.getState().setImage('alpine:latest');
    logger.warn('No image specified in the pipeline. Defaulting to alpine:latest'.yellow);
  }
}

/**
 * creates log file for each job in the pipeline,
 * if the log file already exists, clear the contents
 * @param {*} jobs
 */
async function createLogFiles (jobs) {
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

  const pipelineDir = path.dirname(pipelineFile);
  const workdir = pipelineStore.getState().workDir;
  const name = path.basename(pipelineFile);

  try {
    let executor = new DockerExecutor();

    process.on('SIGINT', () => {
      // TODO: 1 set state here to indicate that it was aborted
      logger.info('Terminating pipeline'.gray);
      executor.stop();
      if (require.main === module) { process.exit(1); }
    });
    await executor.start({image: currentImage, workingDir: workdir, name });

    // copy files from host to container
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

let promptPromise;

function printJobInfo (nextJobs) {
  const jobNames = nextJobs.map(({name}) => name);
  if (jobNames.length > 1) {
    logger.info(`Running ${jobNames.length} jobs concurrently: '${jobNames.join('\', \'')}'`.blue);
  } else if (jobNames.length === 1) {
    logger.info(`Running job: '${jobNames[0]}'`.blue);
  }
  // TODO: when a job is running, show dot indicator for progress + prevent timeouts
}

async function closeAllLogStreams () {
  const promises = [];
  for (const stream of Object.keys(logStreams)) {
    promises.push(logStreams[stream].end());
    delete logStreams[stream];
  }
  await Promise.allSettled(promises);
}

/**
 * Runs a job on the executor
 * @param {*} executor The executor that abstracts the job execution
 * @param {*} job The definition of the job
 * @returns
 */
async function runJob (executor, job) {
  const state = pipelineStore.getState();
  const { outputDir } = state;
  const { logFilePath } = job;

  // set the job ID
  pipelineStore.getState().setJobId(job);

  // empty out the artifacts directory
  let artifactsPathDest;
  if (job.artifactsDir) {
    artifactsPathDest = path.join(outputDir, 'jobs', job.name, 'artifacts');
    if (fs.existsSync(artifactsPathDest)) {
      await fs.promises.rm(artifactsPathDest, { recursive: true, force: true });
    }
    await fs.promises.mkdir(artifactsPathDest, { recursive: true });
  }

  let logStream = logStreams[logFilePath];
  if (!logStream?.writable) {
    logStream?.end();
    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    logStreams[logFilePath] = logStream;
  }

  // group the steps into one array of commands
  const commands = [];
  const output = pipelineStore.getState().getJobOutputs();
  for (const step of job.steps) {
    commands.push(Handlebars.compile(step.command)({ output }));
  }

  let exitCode;
  try {
    const opts = {
      clone: !!job.group, // jobs that are part of a group are run in parallel and need to be cloned
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
    // 'isKilled' means the job was killed by us so don't do anything
    if (err.isKilled) {
      return;
    }
    logger.error('Uncaught error:', err);
    throw err;
  }

  pipelineStore.getState().setJobStatus(job, exitCode === 0 ? JOB_STATUS.PASSED : JOB_STATUS.FAILED);

  // when the job is done, check now if the pipeline has passed or failed
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
      if (require.main === module) {
        process.exit(exitCode);
      } else {
        return;
      }
    }

    // prompt user to select their next action
    promptPromise?.cancel();
    promptPromise = select({
      message: 'Select next action',
      choices: [
        { name: 'quit', value: 'quit', description: 'Exit pipeline' },
        // { name: 're-run', value: 'rerun', description: 'Re-run pipeline from beginning' },
      ],
    });
    try {
      const selection = await promptPromise;
      if (selection === 'quit') {
        logger.info('Stopping executor and exiting pipeline...'.gray);
        await Promise.all([executor?.stop(), closeAllLogStreams()]);
        if (require.main === module) { process.exit(0); }
      }
    } catch (e) {
      // prompt was cancelled if we reach here. do nothing.
    }
    return;
  }

  await runNextJobs(executor);
}

/**
 * When user changes a file, this gets triggered and jobs are re-run
 * @param {*} executor
 * @param {*} filePath The path to the file that was just changed
 */
async function restartJobs (executor, filePath) {
  // get a list of jobs that were invalidated by the file change
  const invalidatedJobs = pipelineStore.getState().resetJobs(filePath);
  if (invalidatedJobs.length > 0) {
    logger.info(`\n${filePath} changed. Re-running pipeline.`.gray);
  }

  // kill invalidated jobs
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

/**
 * Run the next set of jobs that are on deck
 * @param {*} executor
 */
async function runNextJobs (executor) {
  promptPromise?.cancel();
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

// debouncing 'runNextJobs' makes it so that it will wait for the user to
// stop typing for 2s before running any jobs
const DEBOUNCE_MINIMUM = 2 * 1000; // 2 seconds
const debouncedRunNextJobs = debounce(runNextJobs, DEBOUNCE_MINIMUM);

/**
 * Entry point to Carry-On. This is where the pipeline is built and
 * the jobs start running
 * @param {*} param0
 * @returns
 */
async function run ({ file, opts = {} }) {
  const pipelineFile = path.resolve(process.cwd(), file);
  let executor;

  // add the workflow syntax (image, job, etc...) to global namespace
  // (unless user opted out via CLI flag)
  if (!opts.noGlobalVariables) {
    for (const key of Object.keys(apiNamespace)) {
      global[key] = apiNamespace[key];
    }
    global.helpers = {};
    for (const key of Object.keys(pipelineHelpers)) {
      global.helpers[key] = pipelineHelpers[key];
    }
  }

  const err = await buildPipeline(pipelineFile);
  if (err) {
    return;
  }
  executor = await buildExecutor(pipelineFile);
  const isProgrammatic = require.main !== module;
  pipelineStore.getState().setExitOnDone(!!(opts.ci || process.env.CI) || isProgrammatic);

  if (!pipelineStore.getState().exitOnDone) {
    await runVisualizer();
  }

  const pipelineDir = path.dirname(pipelineFile);
  const { ignorePatterns, files, exitOnDone } = pipelineStore.getState();

  // run the pipeline
  const isWatchedProcess = require.main === module && !exitOnDone;
  try {
    const { outputDir } = pipelineStore.getState();
    logger.info(`Running pipeline. Outputting results to '${outputDir}'`.blue);
    await fs.promises.rm(outputDir, { recursive: true, force: true });
    await createLogFiles(pipelineStore.getState().jobs);
    runNextJobs(executor);
  } catch (error) {
    logger.error(`Pipeline execution failed`.red);
    logger.error(error);
    if (executor) {
      await executor.stop();
    }
    if (require.main === module) {process.exit(1);}
  }

  // if it's being run programmatically or in CI mode then end it after first run is done
  if (!isWatchedProcess) {
    return await new Promise((resolve, reject) => {
      pipelineStore.subscribe((state) => {
        const pipelineStatus = state.getPipelineStatus();
        if (pipelineStatus === PIPELINE_STATUS.PASSED) {
          Promise.all([executor?.stop(), closeAllLogStreams()]).then(() => {
            resolve();
          });
        } else if (pipelineStatus === PIPELINE_STATUS.FAILED) {
          Promise.all([executor?.stop(), closeAllLogStreams()]).then(reject);
        }
      });
    });
  }

  // if it's interactive mode (ie: not 'exitOnDone') then watch for file changes
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
    promptPromise?.cancel();
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
}

// Main execution for when Carry-On is run via command line
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
