# CARRY-ON (WORKING TITLE)

Carry-On is a CLI tool that let's you define your CI/CD pipelines as a JS file (no YML, JSON or XML) and then run your pipelines from the command line. With Carry-On, you can leave your pipelines running in the background while you work, and will re-run jobs as you edit your files.  

The goal of Carry-On is that you shouldn't have to wait to push your code changes to the repository for your pipelines to run. Your pipelines should be running continuously as you work.

## PIPELINE SYNTAX

Here's an example of a pipeline

```javascript
image('node:22');
concurrency(2);

job('dependencies', () => {
  onFilesChanged('modules/pipeline-runner/package*.json');
  loginGithubActionsNpmPackages();
  step('npm ci --loglevel verbose');
});

job('lint', () => {
  group('tests');
  step('npm run lint');
});

job('unit-test', () => {
  group('tests');
  step('npm run test');
  artifacts('/ci/coverage');
});
```

What this will do is install dependencies on a Node 22 docker container in the first stage. And then in the second stage, all the jobs with group name "tests" will be run simultaneously (up to a max concurrency 2). This is done by cloning the container from the first stage and then running them as one-off container workflows.

## VIDEO DEMONSTRATION



## TRY IT OUT

Carry-On uses Carry-On to run it's own validation pipelines!

To run these pipelines locally do this
1) check out this repository
2) run `npm ci` to install dependencies
3) run `node . ./node.pipeline.js`
