import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');

export const defaultConfig = {
  browserChannel: 'msedge',
  headless: true,
  slowMo: 0,
  locale: 'en-US',
  queryPrefix: 'hostels in',
  resultLimit: 20,
  maxScrollRounds: 12,
  navigationTimeoutMs: 30000,
  actionTimeoutMs: 10000,
  retryCount: 2,
  retryDelayMs: 1500,
  detailPauseMs: 800,
  enrichWebsite: true,
  websitePageLimit: 8,
  websiteFetchTimeoutMs: 12000,
  websiteUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 KekaScraper/1.0',
  outputDir: path.join(rootDir, 'output'),
};

export function getRootDir() {
  return rootDir;
}
