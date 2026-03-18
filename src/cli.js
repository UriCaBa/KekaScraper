import path from 'node:path';
import process from 'node:process';
import { defaultConfig } from './config.js';
import { launchBrowser } from './lib/browser.js';
import { writeOutputs } from './lib/exporters.js';
import { scrapeCity } from './lib/maps.js';
import { enrichListings } from './lib/website-enricher.js';
import { splitCities, timestampLabel } from './lib/utils.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help || options.cities.length === 0) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const runConfig = {
    ...defaultConfig,
    ...options,
  };

  const { browser, context } = await launchBrowser(runConfig);
  const page = await context.newPage();
  const detailPage = await context.newPage();
  const allResults = [];
  let cityFailures = 0;

  try {
    for (const city of runConfig.cities) {
      try {
        const cityResults = await scrapeCity(page, detailPage, {
          city,
          queryPrefix: runConfig.queryPrefix,
          resultLimit: runConfig.resultLimit,
          maxScrollRounds: runConfig.maxScrollRounds,
          retryCount: runConfig.retryCount,
          retryDelayMs: runConfig.retryDelayMs,
          detailPauseMs: runConfig.detailPauseMs,
        });

        allResults.push(...cityResults);
      } catch (error) {
        cityFailures += 1;
        console.error(`[error] City "${city}" failed: ${error.message}`);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const finalResults = runConfig.enrichWebsite
    ? await enrichListings(allResults, runConfig)
    : allResults;

  const baseFilename = `hostels-${timestampLabel()}`;
  const outputFiles = await writeOutputs(finalResults, {
    outputDir: runConfig.outputDir,
    baseFilename,
    formats: runConfig.formats,
  });

  console.log(`\n[done] Extracted ${finalResults.length} rows across ${runConfig.cities.length} cities`);
  for (const file of outputFiles) {
    console.log(`[file] ${path.resolve(file)}`);
  }

  if (finalResults.length === 0 || cityFailures === runConfig.cities.length) {
    process.exit(1);
  }
}

function parseArgs(argv) {
  const options = {
    cities: [],
    formats: ['json'],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--cities':
        options.cities.push(...splitCities([expectValue(argv, index, arg)]));
        index += 1;
        break;
      case '--city':
        options.cities.push(expectValue(argv, index, arg));
        index += 1;
        break;
      case '--limit':
        options.resultLimit = parseInteger(expectValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--formats':
        options.formats = splitCities([expectValue(argv, index, arg)])
          .map((value) => value.toLowerCase())
          .filter((value) => value === 'json' || value === 'csv');
        index += 1;
        break;
      case '--headful':
        options.headless = false;
        break;
      case '--headless':
        options.headless = true;
        break;
      case '--slow-mo':
        options.slowMo = parseInteger(expectValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--max-scroll-rounds':
        options.maxScrollRounds = parseInteger(expectValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--browser-channel':
        options.browserChannel = expectValue(argv, index, arg);
        index += 1;
        break;
      case '--query-prefix':
        options.queryPrefix = expectValue(argv, index, arg);
        index += 1;
        break;
      case '--enrich':
        options.enrichWebsite = true;
        break;
      case '--no-enrich':
        options.enrichWebsite = false;
        break;
      case '--website-page-limit':
        options.websitePageLimit = parseInteger(expectValue(argv, index, arg), arg);
        index += 1;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown argument: ${arg}`);
        }
        options.cities.push(arg);
        break;
    }
  }

  options.cities = [...new Set(options.cities.map((city) => city.trim()).filter(Boolean))];

  if (!options.formats.length) {
    options.formats = ['json'];
  }

  return options;
}

function expectValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Expected a value after ${flagName}`);
  }
  return value;
}

function parseInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected an integer for ${flagName}, got "${value}"`);
  }
  return parsed;
}

function printHelp() {
  console.log(`
KekaScraper

Usage:
  npm run scrape -- --cities "Barcelona,Bilbao"

Options:
  --cities "A,B,C"         Comma, semicolon, or newline separated cities
  --city "Barcelona"       Repeatable city flag
  --limit 20               Max result rows per city
  --formats json,csv       Output formats
  --headful                Run the browser with UI visible
  --slow-mo 250            Slow down Playwright actions
  --max-scroll-rounds 12   Scroll attempts for result list
  --browser-channel auto|msedge|chrome|chromium
  --query-prefix "hostels in"
  --enrich                 Enrich from the official website
  --no-enrich              Skip website enrichment
  --website-page-limit 8   Max same-domain pages to scan
  --help                   Show this help
`);
}

main().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exit(1);
});
