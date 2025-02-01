image('alpine:latest');
files('./tiny');
concurrency(2);

ignore('./tiny/ignore/**/*');

env('HELLO', 'WORLD!');

// TODO: have 'job' return {{ output.[log A] }}
// const { output: outputLogA } = job('log A', function () {
job('log A', function () {
  onFilesChanged('./tiny/a.log');
  env('HELLO', 'GOODBYE');
  secret('SECRET', 'YOU SHUOLD NOT SEE THIS!!!!');
  step('cat ./tiny/a.log');
  step('echo "\n$HELLO"');
  step('echo "\n$SECRET"');
  step('echo "Smash Mouth" >> "$CI_OUTPUT"');
});

// job('tailing service', function () {
//   service();
//   step('tail "/ci-output/jobs/log A/logs.log"');
// });

job('skip me', function () {
  skip();
  step('echo "if you are seeing this it failed to skip"');
  step('exit 1');
});

job('log B', function () {
  onFilesChanged('./tiny/b.log');
  step('cat ./tiny/b.log');
  step('echo "\n$HELLO"');
  step('if [ "{{output.[log A]}}" != "Smash Mouth" ]; then exit 3; fi');
  // passingCondition((exitCode, stdErr, stdOut) => {}); // TODO: Add a passingCondition functionality
  // step('echo {{outputs["log A"]}}');
});

job('echo world', function () {
  onFilesChanged('./tiny/c.log');
  group('echos');
  step('sleep 5');
  step('echo world');
});

job('echo hey', function () {
  onFilesChanged('./tiny/a.log');
  group('echos');
  step('sleep 10');
  step('echo hey');
});

job('echo hello', function () {
  onFilesChanged('./tiny/a.log');
  group('echos');
  step('sleep 5');
  step('echo hello');
});