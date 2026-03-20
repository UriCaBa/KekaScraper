import assert from 'node:assert/strict';

import {
  countUniqueCities,
  normalizePotentialUrl,
  normalizePublicUrl,
  splitCityInput,
  splitDelimitedValues,
} from '../src/shared/input-normalization.js';
import { normalizeUrl } from '../src/lib/utils.js';

export const tests = [
  {
    name: 'splitCityInput preserves commas inside a city token',
    run: () => {
      assert.deepEqual(splitCityInput([' Barcelona, Bilbao\nDonostia ; Barcelona ']), [
        'Barcelona, Bilbao',
        'Donostia',
        'Barcelona',
      ]);
    },
  },
  {
    name: 'city counters deduplicate normalized cities',
    run: () => {
      assert.equal(countUniqueCities('Barcelona\nBilbao\nBarcelona'), 2);
    },
  },
  {
    name: 'splitDelimitedValues supports comma-separated output formats',
    run: () => {
      assert.deepEqual(splitDelimitedValues(['json,csv']), ['json', 'csv']);
    },
  },
  {
    name: 'normalizePotentialUrl and normalizePublicUrl reject unsafe public values',
    run: () => {
      assert.equal(normalizePotentialUrl('example.com'), 'https://example.com');
      assert.equal(normalizePotentialUrl('foo:8080'), '');
      assert.equal(normalizePublicUrl('example.com'), 'https://example.com/');
      assert.equal(normalizePublicUrl('null'), null);
      assert.equal(normalizePublicUrl('https://trusted.com@evil.com'), null);
    },
  },
  {
    name: 'normalizeUrl mirrors the same safety rules for backend website enrichment',
    run: () => {
      assert.equal(normalizeUrl('example.com'), 'https://example.com/');
      assert.equal(normalizeUrl('foo:8080'), null);
      assert.equal(normalizeUrl('https://trusted.com@evil.com'), null);
    },
  },
];
