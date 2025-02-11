image('node:22');
ignore('node_modules/**/*');
ignore('**/node_modules/**/*')
ignore('.git/**/*');

workdir('ci/');
concurrency(3);
output('output-ci/');

helpers.secretsFile('.env');

function installNode () {
  step(`apk add --no-cache curl`);
  step('curl -fsSL https://deb.nodesource.com/setup_18.x | sh');
  step('apk add --no-cache nodejs npm');
  step('echo "installed node"');
  step('node --version');
}

function loginGithubActionsNpmPackages () {
  step('echo "//npm.pkg.github.com/:_authToken=$GH_NPM_TOKEN" > ~/.npmrc');
  step('echo "@dpgraham:registry=https://npm.pkg.github.com" >> ~/.npmrc');
}

// TODO: allow exposing a port from inside container to outside
// port(HOST_PORT, CONTAINER_PORT);

// TODO: bug ... it's not showing status in /job page
job('dependencies', () => {
  onFilesChanged('package*.json');
  loginGithubActionsNpmPackages();
  step('npm ci --loglevel verbose');
});

// TODO: add a 'service' type of job where the exec keeps running on a cloned container
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
  env('DOCKER_VERSION', '');
  // workdir('') // TODO: allow setting workdir here too
  copy('/ci'); // copies the files from the main container into this one
  group('tests');
  installNode();
  step('cd /ci');
  step('npm run test');
  artifacts('/ci/coverage');
});

// job('commit-and-push', () => {
//   image('<base-image>');
//   copy('/filepath'); // TODO: copies files from the main image into this one
//   commit('<tag-name>'); // TODO: commits this image with <tag-name>
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
