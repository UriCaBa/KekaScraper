import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');
const staticContentTypes = new Map([
  ['.html', 'text/html'],
  ['.js', 'text/javascript'],
  ['.css', 'text/css'],
]);

const defaults = {
  outputDirectory: 'C:/Temp/KekaScraper/output',
  supportsBundledChromium: true,
  appVersion: 'smoke-renderer',
  formState: {
    citiesText: 'Barcelona\nBilbao',
    resultLimit: 2,
    browserChannel: 'auto',
    headful: false,
    enrichWebsite: true,
    formats: ['json'],
  },
};

const smokeResult = {
  summary: {
    totalResults: 2,
    totalCities: 2,
    outputDirectory: defaults.outputDirectory,
    outputFiles: [`${defaults.outputDirectory}/hostels-smoke.json`],
    outcome: 'success',
    durationMs: 1200,
  },
  outputFiles: [`${defaults.outputDirectory}/hostels-smoke.json`],
  previewResults: [
    {
      name: 'Smoke Hostel 1',
      searchedCity: 'Barcelona',
      website: 'https://example-1.test/',
      generalEmail: 'hello1@example-1.test',
      bestContactChannel: 'general-email',
      bestContactValue: 'hello1@example-1.test',
    },
    {
      name: 'Smoke Hostel 2',
      searchedCity: 'Bilbao',
      website: 'https://example-2.test/',
      generalEmail: 'hello2@example-2.test',
      bestContactChannel: 'general-email',
      bestContactValue: 'hello2@example-2.test',
    },
  ],
};

let server;
let browser;

try {
  server = await startStaticServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleMessages = [];
  const pageErrors = [];

  page.on('console', (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.addInitScript(
    ({ nextDefaults, nextSmokeResult }) => {
      const listeners = new Set();

      function emit(event) {
        for (const listener of listeners) {
          listener(event);
        }
      }

      window.oricalApp = {
        getDefaults: async () => structuredClone(nextDefaults),
        startScrape: async (payload) => {
          window.__KEKA_SMOKE_START_PAYLOAD = structuredClone(payload);
          emit({
            type: 'run-started',
            startedAt: new Date().toISOString(),
            cities: ['Barcelona', 'Bilbao'],
            outputDirectory: nextDefaults.outputDirectory,
          });
          emit({
            type: 'browser-ready',
            requestedBrowserChannel: payload.browserChannel,
            selectedBrowserLabel: 'Smoke Browser',
          });
          emit({
            type: 'city-started',
            city: 'Barcelona',
            index: 1,
            totalCities: 2,
          });
          emit({
            type: 'city-completed',
            city: 'Barcelona',
            index: 1,
            totalCities: 2,
            cityResultCount: 1,
            totalResultCount: 1,
          });
          emit({
            type: 'city-started',
            city: 'Bilbao',
            index: 2,
            totalCities: 2,
          });
          emit({
            type: 'city-completed',
            city: 'Bilbao',
            index: 2,
            totalCities: 2,
            cityResultCount: 1,
            totalResultCount: 2,
          });
          emit({
            type: 'enrichment-started',
            totalListings: 2,
          });
          emit({
            type: 'run-completed',
            summary: structuredClone(nextSmokeResult.summary),
          });
          return structuredClone(nextSmokeResult);
        },
        openOutputFolder: async () => {},
        openOutputFile: async () => {},
        openExternalUrl: async () => {},
        loadResultsFile: async () => null,
        loadAllResults: async () => ({ results: [], fileCount: 0 }),
        pickOutputFolder: async () => null,
        onScrapeEvent: (handler) => {
          listeners.add(handler);
          return () => listeners.delete(handler);
        },
      };
    },
    { nextDefaults: defaults, nextSmokeResult: smokeResult },
  );

  await page.goto(server.url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#run-button')?.textContent === 'Start scrape');

  const initialPhase = await page.locator('#status-phase').textContent();
  const initialButtonDisabled = await page.locator('#run-button').isDisabled();
  assert(initialPhase === 'Idle', `Expected renderer smoke to reach Idle, got "${initialPhase}"`);
  assert(initialButtonDisabled === false, 'Expected run button to be enabled after bootstrap');

  await page.locator('#run-button').click();
  await page.waitForFunction(() => document.querySelector('#status-phase')?.textContent === 'Completed');
  await page.waitForFunction(() => document.querySelector('#ls-count')?.textContent?.includes('2 hostel'));
  await page.waitForFunction(() => document.querySelector('#run-button')?.textContent === 'Start scrape');

  const submittedPayload = await page.evaluate(() => window.__KEKA_SMOKE_START_PAYLOAD);
  const activityLog = await page.locator('#activity-log').textContent();
  const lsCount = await page.locator('#ls-count').textContent();

  assert(submittedPayload && typeof submittedPayload === 'object', 'Expected a submitted payload');
  assert(!Object.hasOwn(submittedPayload, 'websitePageLimit'), 'Renderer should not submit websitePageLimit anymore');
  assert(activityLog.includes('Run success.'), 'Expected the completion log to be rendered');
  assert(lsCount.includes('2 hostel'), `Expected "2 hostel" in Last Scrape count, got "${lsCount}"`);

  const unexpectedConsoleMessages = consoleMessages.filter(
    (message) => !message.includes("Content Security Policy directive 'frame-ancestors' is ignored"),
  );
  assert(pageErrors.length === 0, `Unexpected page errors: ${pageErrors.join(' | ')}`);
  assert(
    unexpectedConsoleMessages.length === 0,
    `Unexpected console messages: ${unexpectedConsoleMessages.join(' | ')}`,
  );

  console.log('Renderer smoke passed.');
} finally {
  await Promise.allSettled([browser?.close(), stopStaticServer(server)]);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const relativePath = requestPath === '/' ? 'src/ui/index.html' : requestPath.replace(/^\/+/, '');
      const filePath = path.resolve(rootDir, relativePath);

      if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
        throw new Error('Invalid path');
      }

      const body = await readFile(filePath);

      response.statusCode = 200;
      response.setHeader('Content-Type', staticContentTypes.get(path.extname(filePath)) ?? 'text/plain');
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start the static server for renderer smoke test.');
  }

  return {
    instance: server,
    url: `http://127.0.0.1:${address.port}/src/ui/index.html`,
  };
}

async function stopStaticServer(handle) {
  if (!handle?.instance) {
    return;
  }

  await new Promise((resolve, reject) => {
    handle.instance.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
