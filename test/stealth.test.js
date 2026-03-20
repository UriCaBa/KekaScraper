import assert from 'node:assert/strict';
import { CHROME_USER_AGENTS, VIEWPORT_POOL, getStealthLaunchArgs, jitter, pickRandom } from '../src/lib/stealth.js';

export const tests = [
  {
    name: 'pickRandom returns element from array with deterministic random',
    run() {
      const items = ['a', 'b', 'c'];
      const result = pickRandom(items, () => 0);
      assert.equal(result, 'a');

      const result2 = pickRandom(items, () => 0.99);
      assert.equal(result2, 'c');
    },
  },
  {
    name: 'pickRandom clamps index when randomFn returns 1',
    run() {
      const items = ['a', 'b', 'c'];
      const result = pickRandom(items, () => 1);
      assert.equal(result, 'c');
    },
  },
  {
    name: 'pickRandom returns undefined for empty array',
    run() {
      assert.equal(
        pickRandom([], () => 0),
        undefined,
      );
      assert.equal(
        pickRandom(null, () => 0),
        undefined,
      );
    },
  },
  {
    name: 'jitter returns lower bound when randomFn returns 0',
    run() {
      const result = jitter(800, 0.3, () => 0);
      assert.equal(result, 560);
    },
  },
  {
    name: 'jitter returns upper bound when randomFn returns 1',
    run() {
      const result = jitter(800, 0.3, () => 1);
      assert.equal(result, 1040);
    },
  },
  {
    name: 'jitter always returns an integer',
    run() {
      for (let i = 0; i < 20; i += 1) {
        const result = jitter(800, 0.3, () => i / 20);
        assert.equal(result, Math.round(result), `jitter returned non-integer for random=${i / 20}`);
      }
    },
  },
  {
    name: 'CHROME_USER_AGENTS is a non-empty array of Chrome UA strings',
    run() {
      assert.ok(Array.isArray(CHROME_USER_AGENTS));
      assert.ok(CHROME_USER_AGENTS.length >= 3);
      for (const ua of CHROME_USER_AGENTS) {
        assert.ok(typeof ua === 'string');
        assert.ok(ua.includes('Chrome/'), `UA missing Chrome/ token: ${ua}`);
        assert.ok(!ua.includes('KekaScraper'), `UA must not contain KekaScraper: ${ua}`);
      }
    },
  },
  {
    name: 'VIEWPORT_POOL entries have required properties',
    run() {
      assert.ok(Array.isArray(VIEWPORT_POOL));
      assert.ok(VIEWPORT_POOL.length >= 3);
      for (const vp of VIEWPORT_POOL) {
        assert.ok(typeof vp.width === 'number' && vp.width > 0);
        assert.ok(typeof vp.height === 'number' && vp.height > 0);
        assert.ok(typeof vp.deviceScaleFactor === 'number' && vp.deviceScaleFactor > 0);
      }
    },
  },
  {
    name: 'getStealthLaunchArgs includes AutomationControlled disable flag',
    run() {
      const args = getStealthLaunchArgs();
      assert.ok(Array.isArray(args));
      assert.ok(args.some((arg) => arg.includes('AutomationControlled')));
    },
  },
];
