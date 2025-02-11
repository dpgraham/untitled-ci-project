image('alpine:latest');
files('./large');
concurrency(2);

env('HELLO', 'WORLD!');

job('log massive file', function () {
  // log out 100 mb as a stress test for the web browser
  for (let i=0; i<20; i++) {
    step(`cat ./big-file.log`);
  }
  // TODO: bug ... when uncommenting this it causes big performance issues
  // for (let j=0; j<5001;j++) {
  //   step(`sleep 0.01`);
  //   step(`echo ${j}`);
  // }
});