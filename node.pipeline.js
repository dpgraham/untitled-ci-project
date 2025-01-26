image('node:22'); // TODO: test out private repository use case

ignore('node_modules/**/*');
ignore('.git/**/*');

workdir('ci/');
concurrency(3);
output('output-ci/');

// mount('src', 'dest'); // TODO: allow mounting of a docker volume

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

job('unit-test', () => {
  image('docker:dind');
  // workdir('') // TODO: allow setting workdir here too
  copy('/ci', '/ci');
  group('tests');
  step('docker --help');
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
