image('node:20');

files('**/*'); // TODO: Make **/* the default
ignore('node_modules/**/*');
ignore('ci-output/**/*');

job('dependencies', () => {
  onFilesChanged('package*.json');
  step('npm ci');
});

job('lint', () => {
  step('npx eslint **/*.js');
});

// group('e2e', () => {
//   job('e2e:a', () => {
//     //step('npm run e2e:test:a');

//   });
//   job('e2e:b', () => {
//     //step('npm run e2e:test:b');
//   });
// });
