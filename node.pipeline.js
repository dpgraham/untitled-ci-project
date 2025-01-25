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

job('lint again', () => {
  group('tests');
  step('npm run lint');
});

job('unit-test', () => {
  // TODO: allow individual tests to have their own image
  image('dind');
  // group('tests');
  // step('npm run test');
});

// group('e2e', () => {
//   job('e2e:a', () => {
//     //step('npm run e2e:test:a');

//   });
//   job('e2e:b', () => {
//     //step('npm run e2e:test:b');
//   });
// });
