image('alpine:latest');
files('./tiny');
concurrency(2);

ignore('./tiny/ignore/**/*');

env('HELLO', 'WORLD!');

job('log A', function () {
  onFilesChanged('./tiny/a.log');
  step('cat ./tiny/a.log');
  step('echo "\n$HELLO"');
  // TODO: allow setting environment variables and secrets here
  // env('hello', 'world');
  // secret('its_a_secret', 'SHUT UUUUUUP!');
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