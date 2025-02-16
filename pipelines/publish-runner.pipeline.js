image('node:22');
files('../modules/');
ignore('**/node_modules/**/*');
ignore('test/**/*');

require('dotenv').config();
secret('NPM_TOKEN', process.env.NPM_TOKEN);

job('publish-package', () => {
  step('echo $NPM_TOKEN');
  step('cd pipeline-visualizer');
  step('npm ci');
  step('npm run build');
  step('cd ../pipeline-runner');
  step('npm ci');
  
  step('echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc');
  
  step('npm publish');
});