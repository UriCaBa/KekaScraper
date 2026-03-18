import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, toCsv } from './utils.js';

export async function writeOutputs(items, options) {
  const {
    outputDir,
    baseFilename,
    formats,
  } = options;

  await ensureDir(outputDir);

  const outputFiles = [];

  if (formats.includes('json')) {
    const jsonPath = path.join(outputDir, `${baseFilename}.json`);
    await fs.writeFile(jsonPath, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
    outputFiles.push(jsonPath);
  }

  if (formats.includes('csv')) {
    const csvPath = path.join(outputDir, `${baseFilename}.csv`);
    await fs.writeFile(csvPath, `${toCsv(items)}\n`, 'utf8');
    outputFiles.push(csvPath);
  }

  return outputFiles;
}
