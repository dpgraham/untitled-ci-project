image('alpine:latest');
files('./tiny');

job('log A', function () {
  step('cat ./tiny/a.log');
});

job('log B', function () {
  step('cat ./tiny/b.log');
});