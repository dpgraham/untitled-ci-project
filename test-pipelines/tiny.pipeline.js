image('alpine:latest');
files('./tiny');

job('log A', function () {
  onFilesChanged('./tiny/a.log');
  step('cat ./tiny/a.log');
});

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