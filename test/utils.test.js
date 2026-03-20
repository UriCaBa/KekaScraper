import assert from 'node:assert/strict';

import { mapWithConcurrency, parseNumber, parseRatingAndReviews, retry } from '../src/lib/utils.js';

export const tests = [
  {
    name: 'mapWithConcurrency preserves order while running multiple workers',
    run: async () => {
      const started = [];
      const results = await mapWithConcurrency([3, 1, 2], 2, async (value, index) => {
        started.push(index);
        await new Promise((resolve) => setTimeout(resolve, value * 5));
        return value * 2;
      });

      assert.deepEqual(results, [6, 2, 4]);
      assert.deepEqual(started, [0, 1, 2]);
    },
  },
  {
    name: 'parseNumber rejects decimal values and handles thousands separators',
    run: () => {
      assert.equal(parseNumber('4,5'), null);
      assert.equal(parseNumber('4.5'), null);
      assert.equal(parseNumber('1,234'), 1234);
      assert.equal(parseNumber('1.234'), 1234);
      assert.equal(parseNumber('100'), 100);
      assert.equal(parseNumber('1 234'), 1234);
      assert.equal(parseNumber(null), null);
      assert.equal(parseNumber(''), null);
    },
  },
  {
    name: 'parseRatingAndReviews does not confuse decimal ratings with review counts',
    run: () => {
      const result = parseRatingAndReviews('(4,5)');
      assert.equal(result.rating, 4.5);
      assert.equal(result.reviewCount, null);
    },
  },
  {
    name: 'retry returns first successful attempt with exponential backoff',
    run: async () => {
      let calls = 0;
      const result = await retry(
        () => {
          calls += 1;
          if (calls < 3) throw new Error(`fail-${calls}`);
          return 'ok';
        },
        { retries: 3, delayMs: 10 },
      );
      assert.equal(result, 'ok');
      assert.equal(calls, 3);
    },
  },
  {
    name: 'retry throws last error when all attempts fail',
    run: async () => {
      await assert.rejects(
        () =>
          retry(
            () => {
              throw new Error('always-fail');
            },
            { retries: 2, delayMs: 10 },
          ),
        { message: 'always-fail' },
      );
    },
  },
];
