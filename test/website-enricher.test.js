import assert from 'node:assert/strict';

import { getEnrichmentCacheKey, extractEmails } from '../src/lib/website-enricher.js';

export const tests = [
  {
    name: 'getEnrichmentCacheKey normalizes websites for cache reuse',
    run: () => {
      assert.equal(getEnrichmentCacheKey('example.com/contact?lang=es#hero'), 'https://example.com/contact');
      assert.equal(getEnrichmentCacheKey('https://example.com/contact/'), 'https://example.com/contact');
      assert.equal(getEnrichmentCacheKey('foo:8080'), null);
    },
  },
  {
    name: 'extractEmails filters asset extensions and structurally invalid addresses',
    run: () => {
      assert.deepEqual(extractEmails('contact info@hostel.com here'), ['info@hostel.com']);
      assert.deepEqual(extractEmails('bg@image.png icon@font.woff style@file.css'), []);
      assert.deepEqual(extractEmails('bad..dots@example.com'), []);
      assert.deepEqual(extractEmails('.leading@example.com'), []);
      assert.deepEqual(extractEmails('trailing.@example.com'), []);
      assert.deepEqual(extractEmails('valid@hostel.com trail.@bad.com'), ['valid@hostel.com']);
    },
  },
];
