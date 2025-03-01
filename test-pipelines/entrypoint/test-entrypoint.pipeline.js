files('./');

job('bash entrypoint', function () {
  image('bash');
  entrypoint(['bash', '--version']);
});

job('use bash shell', function () {
  image('bash');
  shell('bash');
  step('echo ${BASH_VERSION}');
});