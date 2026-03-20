import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');
const electronEntryPath = path.join(rootDir, 'src', 'electron', 'main.js');

let electronApp;

try {
  electronApp = await electron.launch({
    args: [electronEntryPath],
    env: {
      ...process.env,
      CI: '1',
      KEKA_SMOKE_MODE: '1',
    },
  });

  const page = await electronApp.firstWindow();
  const pageErrors = [];
  const consoleMessages = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('console', (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  });

  await page.waitForFunction(() => document.querySelector('#run-button')?.textContent === 'Start scrape');
  assert((await page.locator('#website-page-limit').count()) === 0, 'Desktop UI should not expose website page limit');
  assert((await page.locator('#run-button').isDisabled()) === false, 'Run button should be enabled after bootstrap');
  assert((await page.locator('#status-phase').textContent()) === 'Idle', 'Expected desktop app to reach Idle');

  await page.locator('#cities').fill('Madrid\nLisbon');
  await page.locator('#result-limit').fill('2');
  await page.locator('#run-button').click();

  await page.waitForFunction(() => document.querySelector('#status-phase')?.textContent === 'Completed');
  await page.waitForFunction(() => document.querySelector('#results-summary')?.textContent?.includes('2 rows'));
  await page.waitForFunction(() => document.querySelector('#run-button')?.textContent === 'Start scrape');

  const activityLog = await page.locator('#activity-log').textContent();
  const resultsSummary = await page.locator('#results-summary').textContent();

  assert(activityLog.includes('Run success.'), 'Expected completion log after smoke run');
  assert(resultsSummary.includes('2 rows'), `Expected "2 rows" in results summary, got "${resultsSummary}"`);
  assert(pageErrors.length === 0, `Unexpected page errors: ${pageErrors.join(' | ')}`);

  const unexpectedConsoleMessages = consoleMessages.filter(
    (message) => !message.includes("Content Security Policy directive 'frame-ancestors' is ignored"),
  );
  assert(
    unexpectedConsoleMessages.length === 0,
    `Unexpected console messages: ${unexpectedConsoleMessages.join(' | ')}`,
  );

  console.log('Electron smoke passed.');
} catch (error) {
  throw new Error(
    'Electron smoke requires a real desktop session with GUI access. ' + `Original error: ${error.message}`,
    { cause: error },
  );
} finally {
  await electronApp?.close();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
