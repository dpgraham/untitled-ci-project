import Docker from 'dockerode';

let docker;
function init (...dockerArgs) {
  docker = new Docker(...dockerArgs);
}

function from (pipelineCtx, imageName) {
  if (pipelineCtx.from) {
    // TODO: log and throw an error here
  }
  pipelineCtx.from = imageName;
}

function layer (pipelineCtx, name, cb) {
  if (!pipelineCtx.layers) pipelineCtx.layers = new Map();
  pipelineCtx.layers[name] = cb;
  pipelineCtx.selectedLayer = pipelineCtx.layers[name];
}

async function exec (pipelineCtx, command, ...args) {
  const commandAsArray = command.split(/\w/g).filter((str) => str !== '');
  const res = await pipelineCtx.container.exec({
    Cmd: commandAsArray, AttachStdin: true, AttachStdout: true, ...args,
  });
}

async function startPipeline (pipelineCtx) {
  pipelineCtx.container = docker.createContainer();
}

