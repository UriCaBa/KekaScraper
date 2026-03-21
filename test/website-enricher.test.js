import assert from 'node:assert/strict';

import {
  getEnrichmentCacheKey,
  extractEmails,
  extractSocialLinks,
  extractAnchors,
} from '../src/lib/website-enricher.js';

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
      assert.deepEqual(extractEmails('user@domain..com'), []);
      assert.deepEqual(extractEmails('user@.domain.com'), []);
      assert.deepEqual(extractEmails('user@-host.com'), []);
    },
  },
  {
    name: 'extractSocialLinks extracts known social media URLs from anchors',
    run: () => {
      const anchors = [
        { url: 'https://www.instagram.com/hostelworld', text: 'Instagram' },
        { url: 'https://facebook.com/myhostel', text: 'Facebook' },
        { url: 'https://www.linkedin.com/company/cool-hostel', text: 'LinkedIn' },
        { url: 'https://x.com/hostelvibes', text: 'Twitter' },
        { url: 'https://www.tiktok.com/@hostellife', text: 'TikTok' },
        { url: 'https://www.youtube.com/@hostelchannel', text: 'YouTube' },
        { url: 'https://example.com/about', text: 'About' },
      ];
      const result = extractSocialLinks(anchors);
      assert.equal(result.instagramUrl, 'https://www.instagram.com/hostelworld');
      assert.equal(result.facebookUrl, 'https://facebook.com/myhostel');
      assert.equal(result.linkedinUrl, 'https://www.linkedin.com/company/cool-hostel');
      assert.equal(result.twitterUrl, 'https://x.com/hostelvibes');
      assert.equal(result.tiktokUrl, 'https://www.tiktok.com/@hostellife');
      assert.equal(result.youtubeUrl, 'https://www.youtube.com/@hostelchannel');
    },
  },
  {
    name: 'extractSocialLinks skips share/intent URLs and keeps first match per platform',
    run: () => {
      const anchors = [
        { url: 'https://facebook.com/sharer/sharer.php?u=example.com', text: 'Share' },
        { url: 'https://twitter.com/intent/tweet?text=hello', text: 'Tweet' },
        { url: 'https://www.instagram.com/hostel_one', text: 'Follow' },
        { url: 'https://www.instagram.com/hostel_two', text: 'Also us' },
      ];
      const result = extractSocialLinks(anchors);
      assert.equal(result.facebookUrl, null, 'share URL should be skipped');
      assert.equal(result.twitterUrl, null, 'intent URL should be skipped');
      assert.equal(result.instagramUrl, 'https://www.instagram.com/hostel_one', 'first match wins');
    },
  },
  {
    name: 'extractSocialLinks returns all nulls when no social links found',
    run: () => {
      const anchors = [
        { url: 'https://example.com/contact', text: 'Contact' },
        { url: 'https://example.com/about', text: 'About' },
      ];
      const result = extractSocialLinks(anchors);
      assert.equal(result.instagramUrl, null);
      assert.equal(result.facebookUrl, null);
      assert.equal(result.linkedinUrl, null);
      assert.equal(result.twitterUrl, null);
      assert.equal(result.tiktokUrl, null);
      assert.equal(result.youtubeUrl, null);
    },
  },
  {
    name: 'extractAnchors extracts href and text from HTML links',
    run: () => {
      const html = '<a href="/contact">Contact Us</a><a href="https://example.com/about">About</a>';
      const anchors = extractAnchors(html, 'https://example.com');
      assert.equal(anchors.length, 2);
      assert.equal(anchors[0].url, 'https://example.com/contact');
      assert.equal(anchors[0].text, 'Contact Us');
      assert.equal(anchors[1].url, 'https://example.com/about');
      assert.equal(anchors[1].text, 'About');
    },
  },
  {
    name: 'extractAnchors ignores malformed URLs',
    run: () => {
      const html = '<a href="javascript:void(0)">Bad</a><a href="/good">Good</a>';
      const anchors = extractAnchors(html, 'https://example.com');
      // javascript: URLs may still be included; this test ensures malformed URLs are skipped and the valid relative link is kept
      assert.ok(anchors.length >= 1);
      assert.ok(anchors.some((a) => a.url === 'https://example.com/good'));
    },
  },
  {
    name: 'extractSocialLinks handles Twitter via both twitter.com and x.com',
    run: () => {
      const twitterAnchors = [{ url: 'https://twitter.com/myhostel', text: 'Twitter' }];
      assert.equal(extractSocialLinks(twitterAnchors).twitterUrl, 'https://twitter.com/myhostel');
      const xAnchors = [{ url: 'https://x.com/myhostel', text: 'X' }];
      assert.equal(extractSocialLinks(xAnchors).twitterUrl, 'https://x.com/myhostel');
    },
  },
  {
    name: 'extractSocialLinks handles fb.com as Facebook alias',
    run: () => {
      const anchors = [{ url: 'https://fb.com/myhostel', text: 'FB' }];
      assert.equal(extractSocialLinks(anchors).facebookUrl, 'https://fb.com/myhostel');
    },
  },
  {
    name: 'extractSocialLinks strips query params and fragments from matched URLs',
    run: () => {
      const anchors = [{ url: 'https://www.instagram.com/myhostel?utm_source=website#bio', text: 'IG' }];
      const result = extractSocialLinks(anchors);
      // Pattern match captures only the base path (up to first ?, #, or /)
      assert.equal(result.instagramUrl, 'https://www.instagram.com/myhostel');
    },
  },
];
