const path = require('path');
const glob = require('glob');
const DockerExecutor = require('./executors/docker');
const pipelineStore = require('./pipeline.store');
const { Command } = require('commander');
const chokidar = require('chokidar'); // Add chokidar library
const fs = require('fs'); // Add fs module

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
  pipelineStore.getState().setFiles(globPattern);
};

global.ignore = (...patterns) => {
  pipelineStore.getState().addIgnorePatterns(patterns);
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
      // Replace glob.sync with fs to read files recursively
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
    const pipelineStatus = allJobsPassed ? 'passed' : 'failed';
    pipelineStore.getState().setStatus(pipelineStatus);

    // Log success message if the pipeline passed
    if (pipelineStatus === 'passed') {
      console.log('Pipeline passed');
    }
  }

  // Return the executor so it can be stopped later
  return executor;
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
          await runPipeline(executor);
          const pipelineStatus = pipelineStore.getState().status;
          if (pipelineStatus === 'passed') {
            console.log('Pipeline execution completed successfully.');
          } else {
            console.log('Pipeline execution completed with failures.');
          }
        } catch (error) {
          console.error('Pipeline execution failed:', error);
          if (executor) {
            await executor.stop();
          }
          process.exit(1);
        } finally {
          console.log('Press "q" and Enter to quit the pipeline.');
        }
      };

      executor = await buildPipeline(pipelineFile);

      // Watch for file changes

      // Initial run
      runAndWatchPipeline();
      const watcher = chokidar.watch(pipelineStore.getState().files, { persistent: true });
      watcher.on('change', async (filePath) => {
        console.log(`File ${filePath} has been changed. Re-running the pipeline...`);
        await executor.stopExec(); // TODO: Only stop if the current running job was invalidated
        runAndWatchPipeline();
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
