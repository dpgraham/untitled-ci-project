const { GenericContainer } = require('testcontainers');
const path = require('path');
const fs = require('fs');
const glob = require('glob');

let currentImage = null;
const jobs = [];
const stages = [];
const pipelineElements = [];
let currentFiles = [];
let ignorePatterns = [];


// Pipeline definition functions
global.image = (imageName) => {
  currentImage = imageName;
};

global.job = (name, fn) => {
  const jobDef = { name, steps: [] };
  jobs.push(jobDef);
  pipelineElements.push({ type: 'job', definition: jobDef });
  fn(jobDef);
};

global.stage = (name, fn) => {
  const stageDef = { name, jobs: [] };
  stages.push(stageDef);
  pipelineElements.push({ type: 'stage', definition: stageDef });
  fn(stageDef);
};

global.step = (command) => {
  const currentJob = jobs[jobs.length - 1] || stages[stages.length - 1].jobs[stages[stages.length - 1].jobs.length - 1];
  currentJob.steps.push(command);
};

global.files = (globPattern) => {
  // Store the glob pattern to be used later
  currentFiles = globPattern;
};

global.ignore = (...patterns) => {
  // Add ignore patterns
  ignorePatterns.push(...patterns);
};

async function runPipeline(pipelineFile) {
  // Clear previous definitions
  jobs.length = 0;
  stages.length = 0;
  currentImage = null;
  currentFiles = null;
  ignorePatterns = [];

  // Load and execute the pipeline definition
  require(pipelineFile);

  // Default to Alpine if no image is specified
  if (!currentImage) {
    currentImage = 'alpine:latest';
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
    
    // Output container logs to the terminal
    container.logs().then(stream => {
      stream.on('data', line => {
        console.log(line);
      });
    });

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

  try {
    // Run jobs and stages in the order they were defined
    for (const element of pipelineElements) {
      if (element.type === 'job') {
        await runJob(container, element.definition);
      } else if (element.type === 'stage') {
        await runStage(container, element.definition);
      }
    }
  } catch (e) {
    console.error('Failed ', e.message);
  } finally {
    await container.stop();
  }
}

async function runJob(container, job) {
  console.log(`Running job: ${job.name}`);
  for (const step of job.steps) {
    try {
      console.log(`Executing step: ${step}`);
      const execResult = await container.exec(step);
      console.log('execResult', execResult);
      // TODO: capture the log output and the exit code to mark job status
      
    } catch (error) {
      console.error(`Error executing step: ${step}`);
      console.error(`Error details: ${error.message}`);
      throw error;
    }
  }
}

async function runStage(baseContainer, stage) {
  console.log(`Running stage: ${stage.name}`);
  const promises = stage.jobs.map(async (job) => {
    const clonedContainer = await cloneContainer(baseContainer);
    try {
      await runJob(clonedContainer, job);
    } finally {
      await clonedContainer.stop();
    }
  });
  await Promise.all(promises);
}

async function cloneContainer(container) {
  return new GenericContainer(container.image)
    .withWorkingDir('/app')
    .start();
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
