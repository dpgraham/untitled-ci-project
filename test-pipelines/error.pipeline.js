image('alpine:latest');
files('./tiny');
concurrency(2);

ignore('./tiny/ignore/**/*');

env('HELLO', 'WORLD!');

job('random failure on main container', function () {
  group('all');
  image('alpine:latest');
  retries(3);
  step('exit 1');
  step('echo "this step should be unreachable!"');
});

job('random failure on subcontainer', function () {
  group('all');
  image('alpine:latest');
  retries(3);
  step('exit 1');
});