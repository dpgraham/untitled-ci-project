image('alpine:latest');
files('./tiny');

job('log A', function () {
  step('cat ./tiny/a.log');
});

job('echo hey', function () {
  group('echos');
  step('sleep 5');
  step('echo hey');
});

job('log B', function () {
  step('cat ./tiny/b.log');
});

job('echo hello', function () {
  group('echos');
  step('sleep 1');
  step('echo hello');
});