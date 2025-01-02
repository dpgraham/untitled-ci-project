image('node:20');

ignore('node_modules/**/*');
ignore('.git/**/*');
// TODO: This shouldn't be required to do
ignore('ci-output/**/*');

job('dependencies', () => {
  onFilesChanged('package*.json');
  step('npm ci');
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
