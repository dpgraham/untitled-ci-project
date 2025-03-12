const { run } = require('../src/main');
const path = require('path');
const leftpad = require('left-pad');

describe('main', function () {
  describe('run', function () {
    test('run tiny.pipeine.js in CI mode', async function () {
      const file = path.join(__dirname, '..', '..', '..', 'test-pipelines', 'micro.pipeline.js');
      await run({ file });
    });
    // this test is for demo videos
    test('leftpad works', function () {
      expect(leftpad(30, 4)).toEqual('  30');
    });
  });

  // TODO; figure out why still openhandles. I think maybe TestContainers needs to be closed
});