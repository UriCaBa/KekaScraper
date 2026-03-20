import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');
const electronMainPath = path.join(rootDir, 'src', 'electron', 'main.js');
const preloadPath = path.join(rootDir, 'src', 'electron', 'preload.cjs');

export const tests = [
  {
    name: 'electron main points to the CommonJS preload bridge',
    run: () => {
      const mainSource = fs.readFileSync(electronMainPath, 'utf8');
      assert.match(mainSource, /preload:\s*path\.join\(currentDir,\s*'preload\.cjs'\)/);
    },
  },
  {
    name: 'electron preload CommonJS bridge file exists',
    run: () => {
      assert.equal(fs.existsSync(preloadPath), true);
    },
  },
];
