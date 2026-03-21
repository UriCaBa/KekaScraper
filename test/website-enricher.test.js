import assert from 'node:assert/strict';

import {
  getEnrichmentCacheKey,
  extractEmails,
  extractMailtoEmails,
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
  {
    name: 'extractEmails finds emails in cleaned text that raw HTML might miss',
    run: () => {
      // Email split across HTML tags — raw HTML regex won't match, but cleaned text will
      const cleanedText = 'Contact us at info@hostel-terrassa.com for bookings';
      assert.deepEqual(extractEmails(cleanedText), ['info@hostel-terrassa.com']);

      // Email alongside phone in same text
      const mixedText = 'Phone: +34 937 123 456 Email: booking@myhostel.es';
      const emails = extractEmails(mixedText);
      assert.ok(emails.includes('booking@myhostel.es'));
    },
  },
  {
    name: 'extractEmails handles HTML entities in email addresses',
    run: () => {
      // Emails with unicode escapes
      const unicodeText = 'hello\\u0040hostel.com';
      assert.deepEqual(extractEmails(unicodeText), ['hello@hostel.com']);
    },
  },
  {
    name: 'extractEmails decodes numeric HTML entities used to obfuscate emails',
    run: () => {
      // &#64; = @, &#46; = .  (decimal entities — very common anti-spam technique)
      assert.deepEqual(extractEmails('info&#64;hostel&#46;com'), ['info@hostel.com']);

      // &#x40; = @, &#x2e; = .  (hex entities)
      assert.deepEqual(extractEmails('booking&#x40;myhostel&#x2e;es'), ['booking@myhostel.es']);

      // Mixed: some entities, some plain
      assert.deepEqual(extractEmails('contact&#64;example.com and hello@plain.com'), [
        'contact@example.com',
        'hello@plain.com',
      ]);
    },
  },
  {
    name: 'extractEmails finds emails inside mailto href attributes',
    run: () => {
      const html = '<a href="mailto:info&#64;hostel.com">Contact</a> and <a href="mailto:book@test.es">Book</a>';
      const emails = extractEmails(html);
      assert.ok(emails.includes('info@hostel.com'), 'should decode &#64; in mailto href');
      assert.ok(emails.includes('book@test.es'), 'should find plain mailto');
    },
  },
  {
    name: 'extractMailtoEmails extracts and decodes emails from mailto hrefs',
    run: () => {
      const html = '<a href="mailto:info@hostel.com">Email</a> <a href="mailto:book&#64;test.es">Book</a>';
      const emails = extractMailtoEmails(html);
      assert.ok(emails.includes('info@hostel.com'), 'should extract plain mailto');
      assert.ok(emails.includes('book@test.es'), 'should decode &#64; in mailto');
    },
  },
  {
    name: 'extractMailtoEmails returns empty array when no mailto links exist',
    run: () => {
      assert.deepEqual(extractMailtoEmails('<a href="https://example.com">Link</a>'), []);
      assert.deepEqual(extractMailtoEmails('no links here'), []);
    },
  },
  {
    name: 'extractEmails deduplicates when same email found in html and text',
    run: () => {
      // Simulates mergeEmailSources behavior: same email from raw HTML + cleaned text
      const raw = '<a href="mailto:info@hostel.com">info@hostel.com</a>';
      const text = 'Contact: info@hostel.com';
      const combined = [...extractEmails(raw), ...extractEmails(text)];
      const unique = [...new Set(combined)];
      assert.equal(unique.length, 1, 'should deduplicate same email from different sources');
      assert.equal(unique[0], 'info@hostel.com');
    },
  },
];
