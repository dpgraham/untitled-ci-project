image('node:20');

files('./');
ignore('node_modules/**/*');

job('dependencies', () => {
  //onFilesChanged('package*.json');
  step('npm ci');
});

// parallel('e2e', () => {
//   job('e2e:a', () => {
//     step('npm run e2e:test:a')
//   });
//   job('e2e:b', () => {
//     step('npm run e2e:test:b');
//   });
// });
