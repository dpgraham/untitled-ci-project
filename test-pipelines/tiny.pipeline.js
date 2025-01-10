image('alpine:latest');
files('./tiny');
concurrency(1);

// TODO: Investigate why this log is showing when you do some quick saves of tiny.pipeline.js
// You changed the pipeline file 'tiny.pipeline.js'. Re-starting...
// done stopping everything
// Job echo hey failed with exit code: undefined

// Pipeline is failing
// Press "q" and Enter to quit the pipeline.
// Running job: log A

ignore('./tiny/ignore/**/*');

job('log A', function () {
  onFilesChanged('./tiny/a.log');
  step('cat ./tiny/a.log');
});

// job('log A', function () {
//   onFilesChanged('./tiny/a.log');
//   step('cat ./tiny/a.log');
// });

job('echo hey', function () {
  onFilesChanged('./tiny/a.log');
  group('echos');
  step('sleep 5');
  step('echo hey');
});

job('log B', function () {
  onFilesChanged('./tiny/b.log');
  step('cat ./tiny/b.log');
});

job('echo hello', function () {
  onFilesChanged('./tiny/a.log');
  group('echos');
  step('sleep 1');
  step('echo hello');
});