import assert from 'node:assert/strict';

import { mapWithConcurrency } from '../src/lib/utils.js';

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
];
