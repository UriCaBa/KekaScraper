import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');

export const defaultConfig = {
  browserChannel: 'auto',
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
  websiteUserAgent: buildDefaultUserAgent(),
  outputDir: path.join(rootDir, 'output'),
};

export function getRootDir() {
  return rootDir;
}

function buildDefaultUserAgent() {
  const platformToken = getPlatformToken();

  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 KekaScraper/1.0`;
}

function getPlatformToken() {
  switch (process.platform) {
    case 'darwin':
      return 'Macintosh; Intel Mac OS X 10_15_7';
    case 'linux':
      return 'X11; Linux x86_64';
    default:
      return 'Windows NT 10.0; Win64; x64';
  }
}
