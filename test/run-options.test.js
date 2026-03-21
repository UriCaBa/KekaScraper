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
  {
    name: 'normalizeRunOptions passes through coordinates when lat and lng provided',
    run: () => {
      const result = normalizeRunOptions({ cities: 'Barcelona', lat: 41.3874, lng: 2.1686 }, { requireCities: true });
      assert.deepEqual(result.coordinates, { lat: 41.3874, lng: 2.1686, zoom: 15 });
    },
  },
  {
    name: 'normalizeRunOptions accepts custom zoom level',
    run: () => {
      const result = normalizeRunOptions(
        { cities: 'Barcelona', lat: 41.3874, lng: 2.1686, zoom: 18 },
        { requireCities: true },
      );
      assert.equal(result.coordinates.zoom, 18);
    },
  },
  {
    name: 'normalizeRunOptions returns undefined coordinates when neither lat nor lng provided',
    run: () => {
      const result = normalizeRunOptions({ cities: 'Barcelona' }, { requireCities: true });
      assert.equal(result.coordinates, undefined);
    },
  },
  {
    name: 'normalizeRunOptions throws when only lat is provided without lng',
    run: () => {
      assert.throws(
        () => normalizeRunOptions({ cities: 'Barcelona', lat: 41.3874 }, { requireCities: true }),
        /Both --lat and --lng must be provided together/,
      );
    },
  },
  {
    name: 'normalizeRunOptions throws for out-of-range latitude',
    run: () => {
      assert.throws(
        () => normalizeRunOptions({ cities: 'Barcelona', lat: 91, lng: 2 }, { requireCities: true }),
        /Latitude must be between -90 and 90/,
      );
    },
  },
  {
    name: 'normalizeRunOptions throws for out-of-range longitude',
    run: () => {
      assert.throws(
        () => normalizeRunOptions({ cities: 'Barcelona', lat: 41, lng: 181 }, { requireCities: true }),
        /Longitude must be between -180 and 180/,
      );
    },
  },
  {
    name: 'normalizeRunOptions throws for non-numeric lat/lng values',
    run: () => {
      assert.throws(
        () => normalizeRunOptions({ cities: 'Barcelona', lat: 'abc', lng: 'xyz' }, { requireCities: true }),
        /Latitude and longitude must be valid numbers/,
      );
    },
  },
  {
    name: 'normalizeRunOptions throws for invalid zoom value',
    run: () => {
      assert.throws(
        () => normalizeRunOptions({ cities: 'Barcelona', lat: 41, lng: 2, zoom: 'bad' }, { requireCities: true }),
        /Zoom must be an integer between 1 and 21/,
      );
      assert.throws(
        () => normalizeRunOptions({ cities: 'Barcelona', lat: 41, lng: 2, zoom: 25 }, { requireCities: true }),
        /Zoom must be an integer between 1 and 21/,
      );
    },
  },
];
