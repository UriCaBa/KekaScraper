import assert from 'node:assert/strict';

import {
  countUniqueCities,
  hasUrlCredentials,
  isLikelyPublicHostname,
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
  // --- isLikelyPublicHostname ---
  {
    name: 'isLikelyPublicHostname accepts valid multi-label hostname',
    run: () => {
      assert.equal(isLikelyPublicHostname('example.com'), true);
      assert.equal(isLikelyPublicHostname('sub.example.co.uk'), true);
    },
  },
  {
    name: 'isLikelyPublicHostname accepts hostname with port',
    run: () => {
      assert.equal(isLikelyPublicHostname('example.com:8080'), true);
    },
  },
  {
    name: 'isLikelyPublicHostname accepts IP-like dotted values that match hostname pattern',
    run: () => {
      assert.equal(isLikelyPublicHostname('192.168.1.1'), true);
    },
  },
  {
    name: 'isLikelyPublicHostname rejects invalid tokens',
    run: () => {
      assert.equal(isLikelyPublicHostname('null'), false);
      assert.equal(isLikelyPublicHostname('undefined'), false);
      assert.equal(isLikelyPublicHostname('none'), false);
      assert.equal(isLikelyPublicHostname('n/a'), false);
      assert.equal(isLikelyPublicHostname('localhost'), false);
    },
  },
  {
    name: 'isLikelyPublicHostname rejects single-label hostnames',
    run: () => {
      assert.equal(isLikelyPublicHostname('myhost'), false);
      assert.equal(isLikelyPublicHostname('intranet'), false);
    },
  },
  {
    name: 'isLikelyPublicHostname rejects empty and falsy values',
    run: () => {
      assert.equal(isLikelyPublicHostname(''), false);
      assert.equal(isLikelyPublicHostname(null), false);
      assert.equal(isLikelyPublicHostname(undefined), false);
    },
  },
  // --- hasUrlCredentials ---
  {
    name: 'hasUrlCredentials detects URL with user and password',
    run: () => {
      assert.equal(hasUrlCredentials(new URL('https://user:pass@example.com')), true);
    },
  },
  {
    name: 'hasUrlCredentials returns false for URL without credentials',
    run: () => {
      assert.equal(hasUrlCredentials(new URL('https://example.com')), false);
    },
  },
  {
    name: 'hasUrlCredentials detects URL with only username',
    run: () => {
      assert.equal(hasUrlCredentials(new URL('https://user@example.com')), true);
    },
  },
  {
    name: 'hasUrlCredentials accepts string URL',
    run: () => {
      assert.equal(hasUrlCredentials('https://user:pass@example.com'), true);
      assert.equal(hasUrlCredentials('https://example.com'), false);
    },
  },
];
