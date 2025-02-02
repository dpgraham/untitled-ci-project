image('node:22');
files('../modules/pipeline-runner');
ignore('node_modules/**/*');
ignore('test/**/*');

require('dotenv').config();

secret('GH_NPM_TOKEN', process.env.GH_NPM_TOKEN);

job('publish-package', () => {
  step('echo "//npm.pkg.github.com/:_authToken=$GH_NPM_TOKEN" > ~/.npmrc');
  step('echo "@dpgraham:registry=https://npm.pkg.github.com" >> ~/.npmrc');
  step('npm ci');
  step('npm publish');
});