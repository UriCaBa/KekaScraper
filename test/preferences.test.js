import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadPreferences, savePreferences, sanitizePreferences } from '../src/electron/preferences.js';

const FALLBACK_STATE = { theme: 'light', locale: 'en', fontSize: 14 };

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'keka-prefs-'));
}

export const tests = [
  // --- loadPreferences ---
  {
    name: 'loadPreferences returns fallback state when file does not exist',
    run: async () => {
      const tmpDir = await makeTempDir();
      try {
        const prefs = await loadPreferences(tmpDir, FALLBACK_STATE);
        assert.deepEqual(prefs, FALLBACK_STATE);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'loadPreferences returns fallback state for corrupted JSON',
    run: async () => {
      const tmpDir = await makeTempDir();
      try {
        await fs.writeFile(path.join(tmpDir, 'preferences.json'), '{not valid json!!!', 'utf8');
        const prefs = await loadPreferences(tmpDir, FALLBACK_STATE);
        assert.deepEqual(prefs, FALLBACK_STATE);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'loadPreferences only copies keys from fallback state (allowlist)',
    run: async () => {
      const tmpDir = await makeTempDir();
      try {
        await fs.writeFile(
          path.join(tmpDir, 'preferences.json'),
          JSON.stringify({ theme: 'dark', unknownKey: 'evil', locale: 'es' }),
          'utf8',
        );
        const prefs = await loadPreferences(tmpDir, FALLBACK_STATE);
        assert.equal(prefs.theme, 'dark');
        assert.equal(prefs.locale, 'es');
        assert.equal(prefs.fontSize, 14);
        assert.equal(prefs.unknownKey, undefined);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  // --- savePreferences + loadPreferences round-trip ---
  {
    name: 'savePreferences + loadPreferences round-trip preserves data',
    run: async () => {
      const tmpDir = await makeTempDir();
      try {
        const state = { theme: 'dark', locale: 'fr', fontSize: 18 };
        await savePreferences(tmpDir, state);
        const loaded = await loadPreferences(tmpDir, FALLBACK_STATE);
        assert.equal(loaded.theme, 'dark');
        assert.equal(loaded.locale, 'fr');
        assert.equal(loaded.fontSize, 18);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'savePreferences handles sequential writes (atomicity)',
    run: async () => {
      const tmpDir = await makeTempDir();
      try {
        for (let i = 0; i < 5; i++) {
          await savePreferences(tmpDir, { theme: `theme-${i}`, locale: 'en', fontSize: i });
        }
        const loaded = await loadPreferences(tmpDir, FALLBACK_STATE);
        // The last write should win
        assert.equal(loaded.theme, 'theme-4');
        assert.equal(loaded.locale, 'en');
        assert.equal(loaded.fontSize, 4);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  // --- sanitizePreferences ---
  {
    name: 'sanitizePreferences filters out __proto__ key',
    run: () => {
      const result = sanitizePreferences({ __proto__: 'evil', theme: 'dark' }, FALLBACK_STATE);
      assert.equal(result.theme, 'dark');
      assert.equal(Object.hasOwn(result, '__proto__'), false);
    },
  },
  {
    name: 'sanitizePreferences filters out constructor key',
    run: () => {
      const result = sanitizePreferences({ constructor: 'evil', theme: 'dark' }, FALLBACK_STATE);
      assert.equal(result.theme, 'dark');
      assert.equal(Object.hasOwn(result, 'constructor'), false);
    },
  },
  {
    name: 'sanitizePreferences filters out prototype key',
    run: () => {
      const result = sanitizePreferences({ prototype: 'evil', theme: 'dark' }, FALLBACK_STATE);
      assert.equal(result.theme, 'dark');
      assert.equal(Object.hasOwn(result, 'prototype'), false);
    },
  },
  {
    name: 'sanitizePreferences filters out unknown keys',
    run: () => {
      const result = sanitizePreferences({ unknownKey: 'x', theme: 'dark' }, FALLBACK_STATE);
      assert.equal(result.theme, 'dark');
      assert.equal(result.unknownKey, undefined);
    },
  },
  {
    name: 'sanitizePreferences preserves valid keys',
    run: () => {
      const result = sanitizePreferences({ theme: 'dark', locale: 'es', fontSize: 20 }, FALLBACK_STATE);
      assert.deepEqual(result, { theme: 'dark', locale: 'es', fontSize: 20 });
    },
  },
  {
    name: 'sanitizePreferences returns empty object for null input',
    run: () => {
      assert.deepEqual(sanitizePreferences(null, FALLBACK_STATE), {});
    },
  },
  {
    name: 'sanitizePreferences returns empty object for undefined input',
    run: () => {
      assert.deepEqual(sanitizePreferences(undefined, FALLBACK_STATE), {});
    },
  },
  {
    name: 'sanitizePreferences returns empty object for array input',
    run: () => {
      assert.deepEqual(sanitizePreferences([1, 2, 3], FALLBACK_STATE), {});
    },
  },
];
