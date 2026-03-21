import assert from 'node:assert/strict';
import path from 'node:path';

import { buildCityCompletedPayload, determineOutcome, loadCheckpoint } from '../src/lib/run-scrape.js';

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
  {
    name: 'determineOutcome returns empty when partial run has zero results',
    run: () => {
      assert.equal(determineOutcome(3, 3, 0), 'failed');
      assert.equal(determineOutcome(2, 3, 0), 'empty');
      assert.equal(determineOutcome(2, 3, 5), 'partial');
      assert.equal(determineOutcome(0, 3, 10), 'success');
      assert.equal(determineOutcome(0, 1, 0), 'empty');
    },
  },
  {
    name: 'loadCheckpoint returns null when output directory is empty',
    run: async () => {
      const os = await import('node:os');
      const fs = await import('node:fs/promises');
      const tmpDir = await fs.mkdtemp(path.join(os.default.tmpdir(), 'keka-test-'));
      try {
        const result = await loadCheckpoint(tmpDir);
        assert.equal(result, null);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'loadCheckpoint returns null for corrupted checkpoint file',
    run: async () => {
      const os = await import('node:os');
      const fs = await import('node:fs/promises');
      const tmpDir = await fs.mkdtemp(path.join(os.default.tmpdir(), 'keka-test-'));
      try {
        await fs.writeFile(path.join(tmpDir, '20260321-checkpoint.json'), 'not json', 'utf8');
        const result = await loadCheckpoint(tmpDir);
        assert.equal(result, null);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'loadCheckpoint reads valid checkpoint and returns structured data',
    run: async () => {
      const os = await import('node:os');
      const fs = await import('node:fs/promises');
      const tmpDir = await fs.mkdtemp(path.join(os.default.tmpdir(), 'keka-test-'));
      try {
        const checkpoint = {
          runId: '20260321-143022',
          completedCities: ['Barcelona', 'Madrid'],
          results: [{ name: 'Hostel A' }, { name: 'Hostel B' }],
          updatedAt: '2026-03-21T14:45:10.000Z',
        };
        await fs.writeFile(path.join(tmpDir, '20260321-143022-checkpoint.json'), JSON.stringify(checkpoint), 'utf8');
        const result = await loadCheckpoint(tmpDir);
        assert.deepEqual(result.completedCities, ['Barcelona', 'Madrid']);
        assert.equal(result.results.length, 2);
        assert.equal(result.runId, '20260321-143022');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
];
