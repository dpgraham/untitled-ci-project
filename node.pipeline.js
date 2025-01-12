image('node:22');

ignore('node_modules/**/*');
ignore('.git/**/*');

workdir('ci/');
concurrency(3);
output('output-ci/');

// TODO: allow exposing a port from inside container to outside
// port(HOST_PORT, CONTAINER_PORT);

job('dependencies', () => {
  onFilesChanged('package*.json');
  step('npm ci --loglevel verbose');
});

job('lint', () => {
  step('npm run lint');
});

// group('e2e', () => {
//   job('e2e:a', () => {
//     //step('npm run e2e:test:a');

//   });
//   job('e2e:b', () => {
//     //step('npm run e2e:test:b');
//   });
// });
