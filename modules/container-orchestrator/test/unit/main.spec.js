import { runContainer } from '../../src/main';
import Docker from 'dockerode';

describe('container-orchestrator', function () {
  let docker = new Docker();
  describe('.runContainer', function () {
    it('runs a basic alpine container and leaves it running', async function () {
      await runContainer({ docker, containerOpts: {} });
    });
  });
});