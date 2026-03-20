import assert from 'node:assert/strict';

import { defaultConfig } from '../src/config.js';
import { normalizeRunOptions } from '../src/lib/run-options.js';

export const tests = [
  {
    name: 'normalizeRunOptions splits city text but keeps comma-bearing city names atomic in arrays',
    run: () => {
      const normalized = normalizeRunOptions(
        {
          cities: ' Barcelona ; Bilbao\nDonostia ',
          formats: undefined,
        },
        { requireCities: true },
      );

      assert.deepEqual(normalized.cities, ['Barcelona', 'Bilbao', 'Donostia']);
      assert.deepEqual(normalized.formats, defaultConfig.formats);

      const repeatedCityFlags = normalizeRunOptions(
        {
          cities: ['Paris, France', 'New York'],
        },
        { requireCities: true },
      );

      assert.deepEqual(repeatedCityFlags.cities, ['Paris, France', 'New York']);
    },
  },
  {
    name: 'normalizeRunOptions keeps comma-separated format input and validates cities',
    run: () => {
      const normalizedFormats = normalizeRunOptions(
        {
          cities: 'Barcelona',
          formats: 'json,csv',
        },
        { requireCities: true },
      );

      assert.deepEqual(normalizedFormats.formats, ['json', 'csv']);
    },
  },
  {
    name: 'normalizeRunOptions rejects empty city input when cities are required',
    run: () => {
      assert.throws(
        () => normalizeRunOptions({ cities: '   ' }, { requireCities: true }),
        /At least one city is required/,
      );
    },
  },
];
