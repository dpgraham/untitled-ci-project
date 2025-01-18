//const { run } = require('../src/main');
//const path = require('path');
const { expect } = require('@jest/globals');

// TODO: bug
/*
    When two jobs fail simultaneously (lint, unit-test) the job
    exits twice
*/

describe('main', function () {
  describe('run', function () {
    test('stub', function () {

    });
    test('run tiny.pipeine.js in CI mode', async function () {
      // const file = path.join(__dirname, '..', '..', '..', 'test-pipelines', 'tiny.pipeline.js');
      // const opts = { ci: true };
      // TODO: get this test working
      // await run({ file, opts });
    });
    test('check that 2 + 2 is 4', function () {
      expect(2 + 2).toBe(4);
    });
  });
});