import assert from 'node:assert/strict';

import { computeStats, STAT_FILTER_FNS, filterResults } from '../src/shared/dashboard-utils.js';

const FULL_LISTING = {
  name: 'Hostal Barcelona',
  searchedCity: 'Barcelona',
  generalEmail: 'info@hostal.com',
  phone: '+34 933 000 000',
  websitePhone: null,
  decisionMakerName: 'Maria Garcia',
  websiteScanStatus: 'ok',
  instagramUrl: 'https://instagram.com/hostal',
  facebookUrl: null,
  linkedinUrl: null,
  twitterUrl: null,
  tiktokUrl: null,
  youtubeUrl: null,
  bestContactValue: 'info@hostal.com',
  website: 'https://hostal.com',
};

const EMAIL_ONLY = {
  name: 'Alberg Terrassa',
  searchedCity: 'Terrassa',
  generalEmail: 'alberg@example.com',
  phone: null,
  websitePhone: null,
  decisionMakerName: null,
  websiteScanStatus: 'failed',
  instagramUrl: null,
  facebookUrl: null,
  linkedinUrl: null,
  twitterUrl: null,
  tiktokUrl: null,
  youtubeUrl: null,
};

const PHONE_ONLY = {
  name: 'Pension Madrid',
  searchedCity: 'Madrid',
  generalEmail: null,
  phone: null,
  websitePhone: '+34 915 000 000',
  decisionMakerName: null,
  websiteScanStatus: 'ok',
  instagramUrl: null,
  facebookUrl: 'https://facebook.com/pension',
  linkedinUrl: null,
  twitterUrl: null,
  tiktokUrl: null,
  youtubeUrl: null,
};

const TIKTOK_ONLY = {
  name: 'Hostal TikTok',
  searchedCity: 'Sevilla',
  generalEmail: null,
  phone: null,
  websitePhone: null,
  decisionMakerName: null,
  websiteScanStatus: 'no-website',
  instagramUrl: null,
  facebookUrl: null,
  linkedinUrl: null,
  twitterUrl: null,
  tiktokUrl: 'https://tiktok.com/@hostal',
  youtubeUrl: null,
};

const EMPTY_LISTING = {
  name: 'Empty Place',
  searchedCity: 'Valencia',
  generalEmail: null,
  phone: null,
  websitePhone: null,
  decisionMakerName: null,
  websiteScanStatus: 'no-website',
  instagramUrl: null,
  facebookUrl: null,
  linkedinUrl: null,
  twitterUrl: null,
  tiktokUrl: null,
  youtubeUrl: null,
};

const ALL_LISTINGS = [FULL_LISTING, EMAIL_ONLY, PHONE_ONLY, TIKTOK_ONLY, EMPTY_LISTING];

export const tests = [
  // ── computeStats ──
  {
    name: 'computeStats counts all stat categories correctly',
    run: () => {
      const stats = computeStats(ALL_LISTINGS);
      assert.equal(stats.total, 5);
      assert.equal(stats.withEmail, 2, 'FULL + EMAIL_ONLY have generalEmail');
      assert.equal(stats.withPhone, 2, 'FULL has phone, PHONE_ONLY has websitePhone');
      assert.equal(stats.withDm, 1, 'only FULL has decisionMakerName');
      assert.equal(stats.enriched, 2, 'FULL and PHONE_ONLY have websiteScanStatus ok');
      assert.equal(stats.withSocial, 3, 'FULL has instagram, PHONE_ONLY has facebook, TIKTOK_ONLY has tiktok');
    },
  },
  {
    name: 'computeStats returns all zeros for empty array',
    run: () => {
      const stats = computeStats([]);
      assert.deepEqual(stats, { total: 0, withEmail: 0, withPhone: 0, withDm: 0, enriched: 0, withSocial: 0 });
    },
  },

  // ── STAT_FILTER_FNS ──
  {
    name: 'STAT_FILTER_FNS.total always returns true',
    run: () => {
      assert.equal(STAT_FILTER_FNS.total(EMPTY_LISTING), true);
      assert.equal(STAT_FILTER_FNS.total(FULL_LISTING), true);
    },
  },
  {
    name: 'STAT_FILTER_FNS.withEmail matches only listings with generalEmail',
    run: () => {
      assert.equal(STAT_FILTER_FNS.withEmail(FULL_LISTING), true);
      assert.equal(STAT_FILTER_FNS.withEmail(EMAIL_ONLY), true);
      assert.equal(STAT_FILTER_FNS.withEmail(PHONE_ONLY), false);
      assert.equal(STAT_FILTER_FNS.withEmail(EMPTY_LISTING), false);
    },
  },
  {
    name: 'STAT_FILTER_FNS.withPhone matches phone or websitePhone',
    run: () => {
      assert.equal(STAT_FILTER_FNS.withPhone(FULL_LISTING), true);
      assert.equal(STAT_FILTER_FNS.withPhone(PHONE_ONLY), true);
      assert.equal(STAT_FILTER_FNS.withPhone(EMAIL_ONLY), false);
    },
  },
  {
    name: 'STAT_FILTER_FNS.withDm matches only listings with decisionMakerName',
    run: () => {
      assert.equal(STAT_FILTER_FNS.withDm(FULL_LISTING), true);
      assert.equal(STAT_FILTER_FNS.withDm(EMAIL_ONLY), false);
    },
  },
  {
    name: 'STAT_FILTER_FNS.enriched matches only websiteScanStatus ok',
    run: () => {
      assert.equal(STAT_FILTER_FNS.enriched(FULL_LISTING), true);
      assert.equal(STAT_FILTER_FNS.enriched(PHONE_ONLY), true);
      assert.equal(STAT_FILTER_FNS.enriched(EMAIL_ONLY), false);
      assert.equal(STAT_FILTER_FNS.enriched(EMPTY_LISTING), false);
    },
  },
  {
    name: 'STAT_FILTER_FNS.withSocial matches any social platform',
    run: () => {
      assert.equal(STAT_FILTER_FNS.withSocial(FULL_LISTING), true, 'has instagram');
      assert.equal(STAT_FILTER_FNS.withSocial(PHONE_ONLY), true, 'has facebook');
      assert.equal(STAT_FILTER_FNS.withSocial(TIKTOK_ONLY), true, 'has tiktok');
      assert.equal(STAT_FILTER_FNS.withSocial(EMAIL_ONLY), false);
      assert.equal(STAT_FILTER_FNS.withSocial(EMPTY_LISTING), false);
    },
  },

  // ── filterResults ──
  {
    name: 'filterResults returns all results when no filter or search',
    run: () => {
      const result = filterResults(ALL_LISTINGS, null, '');
      assert.equal(result.length, 5);
    },
  },
  {
    name: 'filterResults applies stat filter',
    run: () => {
      const result = filterResults(ALL_LISTINGS, 'withEmail', '');
      assert.equal(result.length, 2);
      assert.ok(result.includes(FULL_LISTING));
      assert.ok(result.includes(EMAIL_ONLY));
    },
  },
  {
    name: 'filterResults applies search query',
    run: () => {
      const result = filterResults(ALL_LISTINGS, null, 'barcelona');
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'Hostal Barcelona');
    },
  },
  {
    name: 'filterResults combines stat filter and search query',
    run: () => {
      // withPhone filter gives FULL + PHONE_ONLY, then search for "madrid" narrows to PHONE_ONLY
      const result = filterResults(ALL_LISTINGS, 'withPhone', 'madrid');
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'Pension Madrid');
    },
  },
  {
    name: 'filterResults searches across name, city, email, bestContactValue, and website',
    run: () => {
      assert.equal(filterResults(ALL_LISTINGS, null, 'hostal.com').length, 1, 'matches website');
      assert.equal(filterResults(ALL_LISTINGS, null, 'alberg@example').length, 1, 'matches email');
      assert.equal(filterResults(ALL_LISTINGS, null, 'terrassa').length, 1, 'matches city');
    },
  },
  {
    name: 'filterResults ignores unknown stat filter names',
    run: () => {
      const result = filterResults(ALL_LISTINGS, 'nonExistentFilter', '');
      assert.equal(result.length, 5, 'unknown filter returns all results');
    },
  },
];
