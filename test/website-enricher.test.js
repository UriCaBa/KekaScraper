import assert from 'node:assert/strict';

import { getEnrichmentCacheKey } from '../src/lib/website-enricher.js';

export const tests = [
  {
    name: 'getEnrichmentCacheKey normalizes websites for cache reuse',
    run: () => {
      assert.equal(getEnrichmentCacheKey('example.com/contact?lang=es#hero'), 'https://example.com/contact');
      assert.equal(getEnrichmentCacheKey('https://example.com/contact/'), 'https://example.com/contact');
      assert.equal(getEnrichmentCacheKey('foo:8080'), null);
    },
  },
];
