import { tests as browserTests } from './browser.test.js';
import { tests as electronContractsTests } from './electron-contracts.test.js';
import { tests as exportersTests } from './exporters.test.js';
import { tests as inputNormalizationTests } from './input-normalization.test.js';
import { tests as mapsTests } from './maps.test.js';
import { tests as preferencesTests } from './preferences.test.js';
import { tests as runEventsTests } from './run-events.test.js';
import { tests as runOptionsTests } from './run-options.test.js';
import { tests as runScrapeTests } from './run-scrape.test.js';
import { tests as stealthTests } from './stealth.test.js';
import { tests as uiViewModelTests } from './ui-view-model.test.js';
import { tests as utilsTests } from './utils.test.js';
import { tests as websiteEnricherTests } from './website-enricher.test.js';

const suites = [
  { name: 'browser', tests: browserTests },
  { name: 'electron-contracts', tests: electronContractsTests },
  { name: 'exporters', tests: exportersTests },
  { name: 'input-normalization', tests: inputNormalizationTests },
  { name: 'maps', tests: mapsTests },
  { name: 'preferences', tests: preferencesTests },
  { name: 'run-events', tests: runEventsTests },
  { name: 'run-options', tests: runOptionsTests },
  { name: 'run-scrape', tests: runScrapeTests },
  { name: 'stealth', tests: stealthTests },
  { name: 'ui-view-model', tests: uiViewModelTests },
  { name: 'utils', tests: utilsTests },
  { name: 'website-enricher', tests: websiteEnricherTests },
];

const TIMEOUT_MS = 10_000;

let total = 0;
let failed = 0;

for (const suite of suites) {
  console.log(`\n${suite.name}`);

  for (const testCase of suite.tests) {
    total += 1;

    try {
      await Promise.race([
        testCase.run(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Test timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
        ),
      ]);
      console.log(`ok ${total} - ${testCase.name}`);
    } catch (error) {
      failed += 1;
      console.log(`not ok ${total} - ${testCase.name}`);
      console.log(error?.stack ?? error?.message ?? String(error));
    }
  }
}

console.log(`\n${total - failed}/${total} tests passed.`);

if (failed > 0) {
  process.exitCode = 1;
}
