import path from 'node:path';
import { defaultConfig } from '../config.js';
import { launchBrowser } from './browser.js';
import { writeOutputs } from './exporters.js';
import { scrapeCity } from './maps.js';
import { createRunEmitter, emitRunEvent, RUN_EVENT_TYPES } from './run-events.js';
import { enrichListings } from './website-enricher.js';
import { normalizeRunOptions } from './run-options.js';
import { timestampLabel } from './utils.js';

export async function runScrape(inputOptions = {}, hooks = {}) {
  const emit = createRunEmitter(hooks.onEvent);
  const startedAt = new Date();
  const runConfig = normalizeRunOptions(inputOptions, { requireCities: true });
  const outputDir = normalizeOutputDir(runConfig.outputDir);
  const normalizedRunConfig = {
    ...runConfig,
    outputDir,
  };

  emitRunEvent(emit, RUN_EVENT_TYPES.RUN_STARTED, {
    startedAt: startedAt.toISOString(),
    cities: normalizedRunConfig.cities,
    outputDirectory: outputDir,
  });

  const { browser, context, launchSummary } = await launchBrowser(normalizedRunConfig);
  emitRunEvent(emit, RUN_EVENT_TYPES.BROWSER_READY, {
    requestedBrowserChannel: normalizedRunConfig.browserChannel,
    selectedBrowserLabel: launchSummary.selectedCandidateLabel,
  });

  const allResults = [];
  let cityFailures = 0;

  try {
    const page = await context.newPage();
    const detailPage = await context.newPage();

    for (const [index, city] of normalizedRunConfig.cities.entries()) {
      emitRunEvent(emit, RUN_EVENT_TYPES.CITY_STARTED, {
        city,
        index: index + 1,
        totalCities: normalizedRunConfig.cities.length,
      });

      try {
        const cityRun = await scrapeCity(page, detailPage, {
          city,
          queryPrefix: normalizedRunConfig.queryPrefix,
          resultLimit: normalizedRunConfig.resultLimit,
          maxScrollRounds: normalizedRunConfig.maxScrollRounds,
          retryCount: normalizedRunConfig.retryCount,
          retryDelayMs: normalizedRunConfig.retryDelayMs,
          detailPauseMs: normalizedRunConfig.detailPauseMs,
          onEvent: emit,
        });

        const cityCompleted = buildCityCompletedPayload({
          city,
          index: index + 1,
          totalCities: normalizedRunConfig.cities.length,
          cityRun,
          totalResultCount: allResults.length,
        });
        const cityResults = cityCompleted.cityResults;
        allResults.push(...cityResults);
        emitRunEvent(emit, RUN_EVENT_TYPES.CITY_COMPLETED, {
          city: cityCompleted.city,
          index: cityCompleted.index,
          totalCities: cityCompleted.totalCities,
          cityResultCount: cityCompleted.cityResultCount,
          totalResultCount: allResults.length,
          cityStats: cityCompleted.cityStats,
        });
      } catch (error) {
        cityFailures += 1;
        emitRunEvent(emit, RUN_EVENT_TYPES.CITY_FAILED, {
          city,
          index: index + 1,
          totalCities: normalizedRunConfig.cities.length,
          message: error.message,
        });
      }
    }
  } finally {
    await Promise.allSettled([context.close(), browser.close()]);
  }

  let finalResults = allResults;
  if (normalizedRunConfig.enrichWebsite) {
    emitRunEvent(emit, RUN_EVENT_TYPES.ENRICHMENT_STARTED, {
      totalListings: allResults.length,
    });

    finalResults = await enrichListings(allResults, normalizedRunConfig, {
      onEvent: emit,
    });
  }

  const baseFilename = `hostels-${timestampLabel()}`;
  const outputFiles = await writeOutputs(finalResults, {
    outputDir,
    baseFilename,
    formats: normalizedRunConfig.formats,
  });

  const finishedAt = new Date();
  const summary = buildSummary({
    startedAt,
    finishedAt,
    runConfig: normalizedRunConfig,
    outputDir,
    cityFailures,
    totalResults: finalResults.length,
    outputFiles,
    launchSummary,
  });

  emitRunEvent(emit, RUN_EVENT_TYPES.RUN_COMPLETED, {
    summary,
  });

  return {
    config: normalizedRunConfig,
    summary,
    results: finalResults,
    outputFiles,
  };
}

function buildSummary({
  startedAt,
  finishedAt,
  runConfig,
  outputDir,
  cityFailures,
  totalResults,
  outputFiles,
  launchSummary,
}) {
  const totalCities = runConfig.cities.length;
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const outputDirectory = outputFiles[0] ? path.dirname(outputFiles[0]) : path.resolve(outputDir);

  let outcome = 'success';
  if (cityFailures === totalCities) {
    outcome = 'failed';
  } else if (cityFailures > 0) {
    outcome = 'partial';
  } else if (totalResults === 0) {
    outcome = 'empty';
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    totalCities,
    cityFailures,
    totalResults,
    outcome,
    exitCode: outcome === 'success' || outcome === 'partial' ? 0 : 1,
    outputFiles,
    outputDirectory,
    selectedBrowserLabel: launchSummary.selectedCandidateLabel,
    requestedBrowserChannel: runConfig.browserChannel,
    enrichWebsite: runConfig.enrichWebsite,
  };
}

function normalizeOutputDir(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : defaultConfig.outputDir;
}

export function buildCityCompletedPayload({ city, index, totalCities, cityRun, totalResultCount = 0 }) {
  const cityResults = Array.isArray(cityRun?.results) ? cityRun.results : [];

  return {
    city,
    index,
    totalCities,
    cityResults,
    cityResultCount: cityResults.length,
    totalResultCount,
    cityStats: normalizeCityStats(cityRun?.stats, cityResults.length),
  };
}

function normalizeCityStats(stats, cityResultCount) {
  return {
    queriesTried: normalizeCount(stats?.queriesTried),
    uniqueCandidates: normalizeCount(stats?.uniqueCandidates),
    listingsProcessed: normalizeCount(stats?.listingsProcessed, cityResultCount),
    listingsAccepted: normalizeCount(stats?.listingsAccepted, cityResultCount),
    listingsSkipped: normalizeCount(stats?.listingsSkipped),
    listingFailures: normalizeCount(stats?.listingFailures),
  };
}

function normalizeCount(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}
