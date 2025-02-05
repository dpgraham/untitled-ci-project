image('alpine:latest');
files('./tiny');
concurrency(2);

ignore('./tiny/ignore/**/*');

env('HELLO', 'WORLD!');

// job('redis', function () {
//   service();
//   image('redis');
//   port('<HOST>', '<CONTAINER>');
//   files('/files/to/copy');
// });

job('log A', function () {
  onFilesChanged('./tiny/a.log');
  env('HELLO', 'GOODBYE');
  secret('SECRET', 'YOU SHUOLD NOT SEE THIS!!!!');
  step('cat a.log');
  step('echo "\n$HELLO"');
  // step.break(); // TODO: add something that stops the pipeline here so user can look at stuff
  // retries(3); // TODO: add a feature to retry it if job is flakey
  step('echo "\n$SECRET"');
  step('echo "Smash Mouth" >> "$CI_OUTPUT"');
});

job('skip me', function () {
  skip();
  step('echo "if you are seeing this it failed to skip"');
  step('exit 1');
});

job('log B', function () {
  onFilesChanged('./tiny/b.log');
  step('cat b.log');
  step('echo "\n$HELLO"');
  step('if [ "{{output.[log A]}}" != "Smash Mouth" ]; then exit 3; fi');
  // passingCondition((exitCode, stdErr, stdOut) => {}); // TODO: Add a passingCondition functionality
});

job('echo world', function () {
  onFilesChanged('c.log');
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