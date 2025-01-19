const { run } = require('../src/main');
const path = require('path');

// TODO: bug
/*
    When two jobs fail simultaneously (lint, unit-test) the job
    exits twice
*/

describe('main', function () {
  describe('run', function () {
    test('run tiny.pipeine.js in CI mode', async function () {
      const file = path.join(__dirname, '..', '..', '..', 'test-pipelines', 'tiny.pipeline.js');
      const opts = { ci: true };
      await run({ file, opts });
    });
  });
});