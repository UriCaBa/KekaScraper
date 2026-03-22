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
  {
    name: 'electron main registers all expected IPC handlers',
    run: () => {
      const mainSource = fs.readFileSync(electronMainPath, 'utf8');
      const expectedChannels = [
        'app:get-defaults',
        'app:pick-output-folder',
        'app:open-external-url',
        'app:load-results-file',
        'app:load-all-results',
        'scrape:start',
        'scrape:open-output-folder',
        'scrape:open-output-file',
      ];
      for (const channel of expectedChannels) {
        assert.match(mainSource, new RegExp(`ipcMain\\.handle\\('${channel}'`), `missing IPC handler: ${channel}`);
      }
    },
  },
  {
    name: 'electron preload exposes all expected bridge methods',
    run: () => {
      const preloadSource = fs.readFileSync(preloadPath, 'utf8');
      const expectedMethods = [
        'getDefaults',
        'startScrape',
        'openOutputFolder',
        'openOutputFile',
        'openExternalUrl',
        'loadResultsFile',
        'loadAllResults',
        'pickOutputFolder',
        'onScrapeEvent',
      ];
      for (const method of expectedMethods) {
        assert.match(preloadSource, new RegExp(`${method}\\s*:`), `missing bridge method: ${method}`);
      }
    },
  },
];
