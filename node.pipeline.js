image('node:22');
ignore('node_modules/**/*');
ignore('**/node_modules/**/*')
ignore('.git/**/*');

workdir('ci/');
concurrency(3);
output('output-ci/');

//helpers.secretsFile('.env');

function installNode () {
  step(`apk add --no-cache curl`);
  step('apk add --no-cache nodejs npm');
  step('echo "installed node"');
  step('node --version');
}

// TODO: 1 -- allow exposing a port from inside container to outside
// port(HOST_PORT, CONTAINER_PORT);

job('dependencies', () => {
  onFilesChanged('modules/pipeline-runner/package*.json');
  step('npm ci --loglevel verbose');
  //step.break();
});

// TODO: 1 -- add a 'service' type of job where the exec keeps running on a cloned container
// job('server', () => {
//   // service();
//   step('npm run build');
//   step('npm start');
// });

job('lint', () => {
  group('tests');
  step('npm run lint');
});

job('unit-test', () => {
  image('docker:dind');
  workdir('/unit');
  artifacts('./coverage');
  env('DOCKER_VERSION', '');
  copy('ci', '.'); // copies the files from the main container into this one
  group('tests');
  installNode();
  step('dockerd &');
  step('npm run test');
});

// job('commit-and-push', () => {
//   image('<base-image>');
//   push('<docker-repo>'); // TODO: pushes this image to a Docker repository
// });

// group('e2e', () => {
//   job('e2e:a', () => {
//     //step('npm run e2e:test:a');

//   });
//   job('e2e:b', () => {
//     //step('npm run e2e:test:b');
//   });
// });
