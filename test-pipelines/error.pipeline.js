image('alpine:latest');
files('./tiny');
concurrency(2);

ignore('./tiny/ignore/**/*');

env('HELLO', 'WORLD!');

job('random failure on main container', function () {
  image('alpine:latest');
  retries(3);
  step('exit 1');
});


job('random failure on subcontainer', function () {
  image('alpine:latest');
  retries(3);
  step('exit 1');
});