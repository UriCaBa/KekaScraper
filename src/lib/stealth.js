import { sleep } from './utils.js';

// Recent Chrome UA strings across common platforms.
// Keep this list updated when Chrome major versions change.
export const CHROME_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
];

// Common desktop viewport sizes with matching device scale factors.
// 1536x864 at 1.25 is the most common Windows laptop config (125% DPI).
export const VIEWPORT_POOL = [
  { width: 1920, height: 1080, deviceScaleFactor: 1 },
  { width: 1366, height: 768, deviceScaleFactor: 1 },
  { width: 1536, height: 864, deviceScaleFactor: 1.25 },
  { width: 1440, height: 900, deviceScaleFactor: 1 },
  { width: 1280, height: 720, deviceScaleFactor: 1 },
];

export function pickRandom(array, randomFn = Math.random) {
  if (!Array.isArray(array) || array.length === 0) {
    return undefined;
  }

  const index = Math.min(Math.floor(randomFn() * array.length), array.length - 1);
  return array[index];
}

export function jitter(baseMs, fraction = 0.3, randomFn = Math.random) {
  const low = baseMs * (1 - fraction);
  const high = baseMs * (1 + fraction);
  return Math.round(low + randomFn() * (high - low));
}

export function jitteredSleep(baseMs, fraction = 0.3) {
  return sleep(jitter(baseMs, fraction));
}

export function getStealthLaunchArgs() {
  return ['--disable-blink-features=AutomationControlled'];
}

// Injected into every page via context.addInitScript() to mask automation signals.
export const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
  });

  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
      { name: 'Native Client', filename: 'internal-nacl-plugin' },
    ],
  });

  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });

  if (!window.chrome) { window.chrome = {}; }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: () => {},
      sendMessage: () => {},
    };
  }
`;
