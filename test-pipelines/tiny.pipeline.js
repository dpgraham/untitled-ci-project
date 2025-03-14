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
  //step.break();
  step('echo "\n$SECRET"');
  step('echo "Smash Mouth" >> "$CI_OUTPUT"');
});

job('skip me', function () {
  skip();
  step('echo "if you are seeing this it failed to skip"');
  step('exit 1');
});

job('print steps', function () {
  onFilesChanged('./tiny/a.log');
  for (let i=0; i<20; i++) {
    step('sleep 1');
    step(`echo ${i}`)
  }
});

job('log B', function () {
  onFilesChanged('./tiny/b.log');
  step('cat b.log');
  step('echo "\n$HELLO"');
  step('if [ "{{output.[log A]}}" != "Smash Mouth" ]; then exit 3; fi');
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