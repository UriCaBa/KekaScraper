import assert from 'node:assert/strict';

import {
  getLaunchCandidates,
  formatCandidateLabels,
  describeBundledChromiumDisabledReason,
} from '../src/lib/browser.js';

export const tests = [
  // --- getLaunchCandidates ---
  {
    name: 'getLaunchCandidates returns auto fallback list with bundled Chromium',
    run: () => {
      const candidates = getLaunchCandidates(undefined);
      assert.ok(candidates.length >= 3);
      const labels = candidates.map((c) => c.label);
      assert.ok(labels.includes('Microsoft Edge'));
      assert.ok(labels.includes('Google Chrome'));
      assert.ok(labels.includes('bundled Chromium'));
    },
  },
  {
    name: 'getLaunchCandidates returns auto fallback without bundled Chromium when disabled',
    run: () => {
      const candidates = getLaunchCandidates('auto', { allowBundledChromium: false });
      const labels = candidates.map((c) => c.label);
      assert.ok(!labels.includes('bundled Chromium'));
      assert.ok(labels.includes('Microsoft Edge'));
    },
  },
  {
    name: 'getLaunchCandidates returns single candidate for specific channel',
    run: () => {
      const candidates = getLaunchCandidates('msedge');
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].label, 'Microsoft Edge');
      assert.deepEqual(candidates[0].launchOptions, { channel: 'msedge' });
    },
  },
  {
    name: 'getLaunchCandidates returns empty for chromium when bundled is disabled',
    run: () => {
      const candidates = getLaunchCandidates('chromium', { allowBundledChromium: false });
      assert.equal(candidates.length, 0);
    },
  },
  {
    name: 'getLaunchCandidates returns bundled candidate for chromium channel',
    run: () => {
      const candidates = getLaunchCandidates('chromium');
      assert.equal(candidates.length, 1);
      assert.ok(candidates[0].label.includes('bundled Chromium'));
      assert.deepEqual(candidates[0].launchOptions, {});
    },
  },
  // --- formatCandidateLabels ---
  {
    name: 'formatCandidateLabels returns comma-separated quoted labels',
    run: () => {
      const candidates = [{ label: 'Microsoft Edge' }, { label: 'Google Chrome' }];
      assert.equal(formatCandidateLabels(candidates), '"Microsoft Edge", "Google Chrome"');
    },
  },
  {
    name: 'formatCandidateLabels returns single quoted label',
    run: () => {
      assert.equal(formatCandidateLabels([{ label: 'Chrome' }]), '"Chrome"');
    },
  },
  {
    name: 'formatCandidateLabels returns empty string for empty array',
    run: () => {
      assert.equal(formatCandidateLabels([]), '');
    },
  },
  // --- describeBundledChromiumDisabledReason ---
  {
    name: 'describeBundledChromiumDisabledReason suggests alternatives for non-chromium channel',
    run: () => {
      const reason = describeBundledChromiumDisabledReason({ browserChannel: 'msedge', allowBundledChromium: true });
      assert.ok(reason.includes('Auto'));
    },
  },
  {
    name: 'describeBundledChromiumDisabledReason explains disabled when allowBundledChromium is false',
    run: () => {
      const reason = describeBundledChromiumDisabledReason({ browserChannel: 'chromium', allowBundledChromium: false });
      assert.ok(reason.includes('disabled'));
    },
  },
  {
    name: 'describeBundledChromiumDisabledReason explains unavailable when chromium allowed but unavailable',
    run: () => {
      const reason = describeBundledChromiumDisabledReason({ browserChannel: 'chromium', allowBundledChromium: true });
      assert.ok(reason.includes('not available'));
    },
  },
];
