image('alpine:latest');
files('./tiny');
concurrency(2);

ignore('./tiny/ignore/**/*');

/* TODO: bug
repro steps
- run tiny.pipeline.js
- edit b.log
- wait for "echo hey" to pass
- edit b.log again right after

observe this 
Job echo hey passed.
Job echo hello passed.
Pipeline is passing
Press "q" and Enter to quit the pipeline.
Job echo hey passed.
Pipeline is passing
Press "q" and Enter to quit the pipeline.

^ pipeline is ending twice
*/

job('log A', function () {
  onFilesChanged('./tiny/a.log');
  step('cat ./tiny/a.log');
  // TODO: allow setting environment variables here
  // env('hello', 'world');
});

// job('log A', function () {
//   onFilesChanged('./tiny/a.log');
//   step('cat ./tiny/a.log');
// });

job('log B', function () {
  onFilesChanged('./tiny/b.log');
  step('cat ./tiny/b.log');
});

job('echo hey', function () {
  onFilesChanged('./tiny/a.log');
  group('echos');
  step('sleep 5');
  step('echo hey');
});

job('echo hello', function () {
  onFilesChanged('./tiny/a.log');
  group('echos');
  step('sleep 1');
  step('echo hello');
});