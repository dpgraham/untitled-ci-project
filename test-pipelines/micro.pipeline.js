image('alpine:latest');
files('./tiny');
concurrency(2);

ignore('./tiny/ignore/**/*');

env('HELLO', 'WORLD!');

job('log A', function () {
  step('sleep 5');
  step('echo "HELLO WORLD"');
});