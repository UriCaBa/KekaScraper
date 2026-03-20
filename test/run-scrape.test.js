import assert from 'node:assert/strict';

import { buildCityCompletedPayload } from '../src/lib/run-scrape.js';

export const tests = [
  {
    name: 'buildCityCompletedPayload preserves city stats from scrapeCity output',
    run: () => {
      const payload = buildCityCompletedPayload({
        city: 'Terrassa',
        index: 1,
        totalCities: 2,
        totalResultCount: 7,
        cityRun: {
          results: [{ name: 'Hostal Example' }, { name: 'Alberg Example' }],
          stats: {
            queriesTried: 4,
            uniqueCandidates: 18,
            listingsProcessed: 12,
            listingsAccepted: 2,
            listingsSkipped: 9,
            listingFailures: 1,
          },
        },
      });

      assert.equal(payload.city, 'Terrassa');
      assert.equal(payload.cityResultCount, 2);
      assert.equal(payload.totalResultCount, 7);
      assert.deepEqual(payload.cityStats, {
        queriesTried: 4,
        uniqueCandidates: 18,
        listingsProcessed: 12,
        listingsAccepted: 2,
        listingsSkipped: 9,
        listingFailures: 1,
      });
    },
  },
  {
    name: 'buildCityCompletedPayload normalizes missing scrapeCity stats safely',
    run: () => {
      const payload = buildCityCompletedPayload({
        city: 'Bilbao',
        index: 2,
        totalCities: 2,
        cityRun: {
          results: [{ name: 'Hostal Nervion' }],
        },
      });

      assert.equal(payload.cityResultCount, 1);
      assert.deepEqual(payload.cityStats, {
        queriesTried: 0,
        uniqueCandidates: 0,
        listingsProcessed: 1,
        listingsAccepted: 1,
        listingsSkipped: 0,
        listingFailures: 0,
      });
    },
  },
];
