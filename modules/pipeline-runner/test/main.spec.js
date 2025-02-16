const { run } = require('../src/main');
const path = require('path');
const leftpad = require('left-pad');

describe('main', function () {
  describe('run', function () {
    test('leftpad works', function () {
      expect(leftpad(30, 4)).toEqual('  30');
    });
    test.skip('run tiny.pipeine.js in CI mode', async function () {
      const file = path.join(__dirname, '..', '..', '..', 'test-pipelines', 'micro.pipeline.js');
      await run({ file });
    });
  });

  // TODO; figure out why still openhandles. I think maybe TestContainers needs to be closed
});