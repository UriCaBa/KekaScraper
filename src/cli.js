import path from 'node:path';
import process from 'node:process';
import { normalizeBrowserChannel, normalizeInteger, normalizeRunOptions } from './lib/run-options.js';
import { RUN_EVENT_TYPES } from './lib/run-events.js';
import { runScrape } from './lib/run-scrape.js';
import { splitDelimitedValues } from './shared/input-normalization.js';
import { splitCities } from './lib/utils.js';

async function main() {
  const runConfig = parseArgs(process.argv.slice(2));

  if (runConfig.help || runConfig.cities.length === 0) {
    printHelp();
    process.exit(runConfig.help ? 0 : 1);
  }

  const { summary, outputFiles } = await runScrape(runConfig, {
    onEvent: handleCliEvent,
  });

  console.log(`\n[done] Extracted ${summary.totalResults} rows across ${summary.totalCities} cities`);
  for (const file of outputFiles) {
    console.log(`[file] ${path.resolve(file)}`);
  }

  if (summary.exitCode !== 0) {
    process.exit(summary.exitCode);
  }
}

function handleCliEvent(event) {
  switch (event.type) {
    case RUN_EVENT_TYPES.BROWSER_READY:
      console.log(`[browser] ${event.selectedBrowserLabel} (requested: ${event.requestedBrowserChannel})`);
      break;
    case RUN_EVENT_TYPES.CITY_SEARCH_STARTED:
      console.log(`\n[city] ${event.city}`);
      console.log(`[search] ${event.searchQuery}`);
      break;
    case RUN_EVENT_TYPES.CITY_SEARCH_RESULTS:
      if (typeof event.aggregatedCandidateCount === 'number') {
        console.log(
          `[results] Found ${event.candidateCount} candidate URLs (${event.aggregatedCandidateCount} unique total so far)`,
        );
      } else {
        console.log(`[results] Found ${event.candidateCount} candidate URLs`);
      }
      break;
    case RUN_EVENT_TYPES.LISTING_SKIPPED:
      console.log(`[skip] ${event.name ?? event.listingUrl}: ${formatListingSkipReason(event)}`);
      break;
    case RUN_EVENT_TYPES.RETRYING:
      console.error(`[retry] ${event.label}: ${event.message}`);
      break;
    case RUN_EVENT_TYPES.CITY_COMPLETED:
      if (event.cityStats) {
        console.log(
          `[city-summary] processed=${event.cityStats.listingsProcessed} accepted=${event.cityStats.listingsAccepted} skipped=${event.cityStats.listingsSkipped} failed=${event.cityStats.listingFailures} uniqueCandidates=${event.cityStats.uniqueCandidates} queries=${event.cityStats.queriesTried}`,
        );
      }
      break;
    case RUN_EVENT_TYPES.LISTING_FAILED:
      console.error(`[detail-failed] ${event.listingUrl}: ${event.message}`);
      break;
    case RUN_EVENT_TYPES.ENRICHMENT_STARTED:
      console.log(`[enrich] Starting website enrichment for ${event.totalListings} listings`);
      break;
    case RUN_EVENT_TYPES.ENRICHMENT_ITEM_SKIPPED:
      console.log(`[enrich-skip] ${describeEnrichmentTarget(event)} (${event.reason})`);
      break;
    case RUN_EVENT_TYPES.ENRICHMENT_ITEM_FAILED:
      console.error(`[enrich-failed] ${describeEnrichmentTarget(event)}: ${event.message}`);
      break;
    case RUN_EVENT_TYPES.WEBSITE_PAGE_SKIPPED:
      console.error(`[website-skip] ${event.url}: ${event.message}`);
      break;
    case RUN_EVENT_TYPES.CITY_FAILED:
      console.error(`[city-failed] ${event.city}: ${event.message}`);
      break;
    default:
      break;
  }
}

function parseArgs(argv) {
  const options = {
    cities: [],
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
        options.formats = splitDelimitedValues([expectValue(argv, index, arg)])
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
        options.slowMo = parseInteger(expectValue(argv, index, arg), arg, { min: 0 });
        index += 1;
        break;
      case '--max-scroll-rounds':
        options.maxScrollRounds = parseInteger(expectValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--browser-channel':
        options.browserChannel = normalizeBrowserChannel(expectValue(argv, index, arg), arg);
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
      case '--lat':
        options.lat = parseFloat(expectValue(argv, index, arg));
        if (Number.isNaN(options.lat)) throw new Error('--lat must be a number');
        index += 1;
        break;
      case '--lng':
        options.lng = parseFloat(expectValue(argv, index, arg));
        if (Number.isNaN(options.lng)) throw new Error('--lng must be a number');
        index += 1;
        break;
      case '--zoom':
        options.zoom = parseInteger(expectValue(argv, index, arg), arg, { min: 1, max: 21 });
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

  return normalizeRunOptions(options, { requireCities: false });
}

function expectValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Expected a value after ${flagName}`);
  }
  return value;
}

function parseInteger(value, flagName, options = {}) {
  return normalizeInteger(value, undefined, flagName, options);
}

function describeEnrichmentTarget(event) {
  return event.name ?? event.website ?? 'listing without website';
}

function formatListingSkipReason(event) {
  const scoreText = typeof event.score === 'number' ? `score=${event.score}` : null;
  const signals = [
    ...(Array.isArray(event.positiveSignals) ? event.positiveSignals : []),
    ...(Array.isArray(event.negativeSignals) ? event.negativeSignals : []),
  ];
  return [event.reason ?? 'skipped', scoreText, signals.length ? `signals=${signals.join(',')}` : null]
    .filter(Boolean)
    .join(' | ');
}

function printHelp() {
  console.log(`
KekaScraper by Orical Labs

Usage:
  npm run scrape -- --cities "Barcelona;Bilbao"

Options:
  --cities "A;B;C"         Semicolon or newline separated cities
  --city "Barcelona"       Repeatable city flag
  --limit 20               Max result rows per city
  --formats json,csv       Output formats
  --headful                Run the browser with UI visible
  --slow-mo 250            Slow down Playwright actions
  --max-scroll-rounds 12   Scroll attempts for result list
  --browser-channel auto|msedge|chrome|chromium  Select browser channel or bundled Chromium
  --query-prefix "hostels in"
  --enrich                 Enrich from the official website
  --no-enrich              Skip website enrichment
  --website-page-limit 8   Max same-domain pages to scan
  --lat 41.3874            Latitude for geo-targeted search
  --lng 2.1686             Longitude for geo-targeted search
  --zoom 15                Zoom level for geo-targeting (1-21, default 15)
  --help                   Show this help
`);
}

main().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exit(1);
});
