image('node:22');
workdir('/files');

job('create file', function () {
  step('touch file.txt');
  step('echo "HELLO WORLD" > file.txt');
});

const version = '0.0.2';
const repo = 'dpgraham/';
const intermediaryImage = `${repo}hello-world-intermediary:latest`;

job('intermediaryImage image', function () {
  image('alpine:latest');
  workdir('/files');
  tag(intermediaryImage);
  copy('/files/file.txt');
});

job('new image', function () {
  image(intermediaryImage);
  entrypoint('/bin/sh');
  command('tail -f /files/file.txt');
  tag(`${repo}hello-world:${version}`);
});