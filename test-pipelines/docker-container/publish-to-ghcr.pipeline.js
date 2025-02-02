image({name: 'docker:dind', privileged: true, detached: true });
require('dotenv').config();

job('publish-to-ghcr', function () {
  env('GHCR_USERNAME', 'dpgraham');
  secret('GHCR_PASSWORD', process.env.GHCR_PASSWORD);
  //step('nohup dockerd &');
  step('sh ./publish-to-ghcr.sh');
});