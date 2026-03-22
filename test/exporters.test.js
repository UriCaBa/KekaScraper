import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { writeOutputs } from '../src/lib/exporters.js';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'keka-exporters-'));
}

export const tests = [
  {
    name: 'writeOutputs writes JSON file with valid content when formats include json',
    run: async () => {
      const tmpDir = await makeTempDir();
      try {
        const items = [{ name: 'Foo', city: 'Barcelona' }];
        await writeOutputs(items, { outputDir: tmpDir, baseFilename: 'test', formats: ['json'] });
        const content = await fs.readFile(path.join(tmpDir, 'test.json'), 'utf8');
        assert.deepEqual(JSON.parse(content), items);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'writeOutputs writes CSV file when formats include csv',
    run: async () => {
      const tmpDir = await makeTempDir();
      try {
        const items = [{ name: 'Foo', city: 'Barcelona' }];
        await writeOutputs(items, { outputDir: tmpDir, baseFilename: 'test', formats: ['csv'] });
        const content = await fs.readFile(path.join(tmpDir, 'test.csv'), 'utf8');
        assert.ok(content.includes('name,city'));
        assert.ok(content.includes('Foo,Barcelona'));
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'writeOutputs writes both when formats is [json, csv]',
    run: async () => {
      const tmpDir = await makeTempDir();
      try {
        const items = [{ a: 1 }];
        await writeOutputs(items, { outputDir: tmpDir, baseFilename: 'out', formats: ['json', 'csv'] });
        const jsonStat = await fs.stat(path.join(tmpDir, 'out.json'));
        const csvStat = await fs.stat(path.join(tmpDir, 'out.csv'));
        assert.ok(jsonStat.isFile());
        assert.ok(csvStat.isFile());
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'writeOutputs returns array of file paths',
    run: async () => {
      const tmpDir = await makeTempDir();
      try {
        const result = await writeOutputs([{ x: 1 }], {
          outputDir: tmpDir,
          baseFilename: 'data',
          formats: ['json', 'csv'],
        });
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 2);
        assert.ok(result[0].endsWith('data.json'));
        assert.ok(result[1].endsWith('data.csv'));
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'writeOutputs handles empty items array',
    run: async () => {
      const tmpDir = await makeTempDir();
      try {
        await writeOutputs([], { outputDir: tmpDir, baseFilename: 'empty', formats: ['json'] });
        const content = await fs.readFile(path.join(tmpDir, 'empty.json'), 'utf8');
        assert.deepEqual(JSON.parse(content), []);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'writeOutputs CSV starts with UTF-8 BOM for Windows Excel compatibility',
    run: async () => {
      const tmpDir = await makeTempDir();
      try {
        const items = [{ name: 'Hostal Niño', city: 'Logroño' }];
        await writeOutputs(items, { outputDir: tmpDir, baseFilename: 'bom', formats: ['csv'] });
        const raw = await fs.readFile(path.join(tmpDir, 'bom.csv'), 'utf8');
        assert.ok(raw.startsWith('\uFEFF'), 'CSV should start with UTF-8 BOM');
        assert.ok(raw.includes('Hostal Niño'), 'CSV should preserve special characters');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'writeOutputs creates output directory if it does not exist',
    run: async () => {
      const tmpDir = await makeTempDir();
      const nestedDir = path.join(tmpDir, 'nested', 'deep');
      try {
        await writeOutputs([{ a: 1 }], { outputDir: nestedDir, baseFilename: 'test', formats: ['json'] });
        const content = await fs.readFile(path.join(nestedDir, 'test.json'), 'utf8');
        assert.deepEqual(JSON.parse(content), [{ a: 1 }]);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  },
];
