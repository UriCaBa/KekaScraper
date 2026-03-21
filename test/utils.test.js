import assert from 'node:assert/strict';

import {
  firstNonEmpty,
  mapWithConcurrency,
  normalizeWhitespace,
  parseNumber,
  parseRating,
  parseRatingAndReviews,
  retry,
  stripFieldPrefix,
  toCsv,
  uniqueNonEmpty,
} from '../src/lib/utils.js';

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
    name: 'mapWithConcurrency actually runs tasks in parallel when concurrency > 1',
    run: async () => {
      const timeline = [];
      const tasks = [50, 50, 50, 50];

      const startTime = Date.now();
      await mapWithConcurrency(tasks, 3, async (delayMs, index) => {
        timeline.push({ index, event: 'start', at: Date.now() - startTime });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        timeline.push({ index, event: 'end', at: Date.now() - startTime });
      });
      const totalTime = Date.now() - startTime;

      // With concurrency=3, 4 tasks of 50ms each should take ~100ms (2 rounds), not ~200ms (4 rounds)
      assert.ok(totalTime < 180, `Expected <180ms for parallel execution, got ${totalTime}ms`);

      // At least 2 tasks should have started before any ended
      const startEvents = timeline.filter((e) => e.event === 'start');
      const firstEnd = timeline.find((e) => e.event === 'end');
      const startsBeforeFirstEnd = startEvents.filter((e) => e.at <= firstEnd.at).length;
      assert.ok(startsBeforeFirstEnd >= 2, `Expected >=2 tasks started before first end, got ${startsBeforeFirstEnd}`);
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
  // --- normalizeWhitespace ---
  {
    name: 'normalizeWhitespace collapses multiple spaces',
    run: () => {
      assert.equal(normalizeWhitespace('  hello   world  '), 'hello world');
    },
  },
  {
    name: 'normalizeWhitespace returns empty string for non-string input',
    run: () => {
      assert.equal(normalizeWhitespace(null), '');
      assert.equal(normalizeWhitespace(42), '');
    },
  },
  {
    name: 'normalizeWhitespace handles tabs and newlines',
    run: () => {
      assert.equal(normalizeWhitespace('hello\t\nworld'), 'hello world');
    },
  },
  // --- firstNonEmpty ---
  {
    name: 'firstNonEmpty returns first non-empty string',
    run: () => {
      assert.equal(firstNonEmpty('', null, 'hello', 'world'), 'hello');
    },
  },
  {
    name: 'firstNonEmpty returns null when all empty',
    run: () => {
      assert.equal(firstNonEmpty('', null, undefined), null);
    },
  },
  {
    name: 'firstNonEmpty normalizes whitespace on returned value',
    run: () => {
      assert.equal(firstNonEmpty('  spaced  '), 'spaced');
    },
  },
  {
    name: 'firstNonEmpty returns non-string truthy values',
    run: () => {
      assert.equal(firstNonEmpty(null, '', 42), 42);
    },
  },
  // --- stripFieldPrefix ---
  {
    name: 'stripFieldPrefix strips Address prefix',
    run: () => {
      assert.equal(stripFieldPrefix('Address: 123 Main St'), '123 Main St');
    },
  },
  {
    name: 'stripFieldPrefix strips Spanish prefix',
    run: () => {
      assert.equal(stripFieldPrefix('Dirección: Calle Mayor'), 'Calle Mayor');
    },
  },
  {
    name: 'stripFieldPrefix strips Website prefix',
    run: () => {
      assert.equal(stripFieldPrefix('Website: example.com'), 'example.com');
    },
  },
  {
    name: 'stripFieldPrefix strips Phone prefix',
    run: () => {
      assert.equal(stripFieldPrefix('Phone: +34 123'), '+34 123');
    },
  },
  {
    name: 'stripFieldPrefix returns null for falsy input',
    run: () => {
      assert.equal(stripFieldPrefix(null), null);
      assert.equal(stripFieldPrefix(''), null);
    },
  },
  // --- uniqueNonEmpty ---
  {
    name: 'uniqueNonEmpty deduplicates and filters empty values',
    run: () => {
      assert.deepEqual(uniqueNonEmpty(['hello', 'world', 'hello', '']), ['hello', 'world']);
    },
  },
  {
    name: 'uniqueNonEmpty normalizes whitespace before deduplication',
    run: () => {
      assert.deepEqual(uniqueNonEmpty(['  a  ', 'a']), ['a']);
    },
  },
  // --- toCsv ---
  {
    name: 'toCsv returns empty string for empty array',
    run: () => {
      assert.equal(toCsv([]), '');
    },
  },
  {
    name: 'toCsv generates headers from object keys',
    run: () => {
      assert.equal(toCsv([{ a: 1, b: 2 }]), 'a,b\n1,2');
    },
  },
  {
    name: 'toCsv escapes values with commas',
    run: () => {
      assert.equal(toCsv([{ name: 'a,b' }]), 'name\n"a,b"');
    },
  },
  {
    name: 'toCsv escapes values with quotes',
    run: () => {
      assert.equal(toCsv([{ name: 'say "hi"' }]), 'name\n"say ""hi"""');
    },
  },
  {
    name: 'toCsv handles null and undefined values',
    run: () => {
      assert.equal(toCsv([{ a: null, b: undefined }]), 'a,b\n,');
    },
  },
  {
    name: 'toCsv merges headers from multiple rows',
    run: () => {
      assert.equal(toCsv([{ a: 1 }, { b: 2 }]), 'a,b\n1,\n,2');
    },
  },
  // --- parseRating ---
  {
    name: 'parseRating parses decimal rating',
    run: () => {
      assert.equal(parseRating('4.5'), 4.5);
    },
  },
  {
    name: 'parseRating parses comma decimal rating',
    run: () => {
      assert.equal(parseRating('4,5'), 4.5);
    },
  },
  {
    name: 'parseRating returns null for empty input',
    run: () => {
      assert.equal(parseRating(''), null);
      assert.equal(parseRating(null), null);
    },
  },
];
