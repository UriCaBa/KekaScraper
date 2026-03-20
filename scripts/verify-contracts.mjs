import assert from 'node:assert/strict';
import { defaultConfig } from '../src/config.js';
import { RUN_EVENT_TYPES } from '../src/lib/run-events.js';
import { normalizeRunOptions } from '../src/lib/run-options.js';
import {
  countUniqueCities,
  normalizePublicUrl,
  splitCityInput,
  splitDelimitedValues,
} from '../src/shared/input-normalization.js';

assert.deepEqual(splitCityInput([' Barcelona, Bilbao\nDonostia ; Barcelona ']), [
  'Barcelona, Bilbao',
  'Donostia',
  'Barcelona',
]);

assert.equal(countUniqueCities('Barcelona\nBilbao\nBarcelona'), 2);

assert.deepEqual(splitDelimitedValues(['json,csv']), ['json', 'csv']);

assert.equal(normalizePublicUrl('example.com'), 'https://example.com/');
assert.equal(normalizePublicUrl('null'), null);
assert.equal(normalizePublicUrl('foo:8080'), null);
assert.equal(normalizePublicUrl('https://trusted.com@evil.com'), null);

const normalized = normalizeRunOptions(
  {
    cities: ' Barcelona ; Bilbao\nDonostia ',
    formats: undefined,
  },
  { requireCities: true },
);

assert.deepEqual(normalized.cities, ['Barcelona', 'Bilbao', 'Donostia']);
assert.deepEqual(normalized.formats, defaultConfig.formats);

const normalizedFormats = normalizeRunOptions(
  {
    cities: 'Barcelona',
    formats: 'json,csv',
  },
  { requireCities: true },
);

assert.deepEqual(normalizedFormats.formats, ['json', 'csv']);

const repeatedCityFlags = normalizeRunOptions(
  {
    cities: ['Paris, France', 'New York'],
  },
  { requireCities: true },
);

assert.deepEqual(repeatedCityFlags.cities, ['Paris, France', 'New York']);
assert.equal(RUN_EVENT_TYPES.RUN_COMPLETED, 'run-completed');

console.log('Shared contracts verified.');
