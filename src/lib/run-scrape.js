import path from 'node:path';
import { launchBrowser } from './browser.js';
import { writeOutputs } from './exporters.js';
import { scrapeCity } from './maps.js';
import { enrichListings } from './website-enricher.js';
import { normalizeRunOptions } from './run-options.js';
import { timestampLabel } from './utils.js';

export async function runScrape(inputOptions = {}, hooks = {}) {
  const emit = createEmitter(hooks.onEvent);
  const startedAt = new Date();
  const runConfig = normalizeRunOptions(inputOptions, { requireCities: true });
  const outputDir = normalizeOutputDir(runConfig.outputDir);

  emit({
    type: 'run-started',
    startedAt: startedAt.toISOString(),
    cities: runConfig.cities,
    outputDirectory: outputDir,
  });

  const { browser, context, launchSummary } = await launchBrowser(runConfig);
  emit({
    type: 'browser-ready',
    requestedBrowserChannel: runConfig.browserChannel,
    selectedBrowserLabel: launchSummary.selectedCandidateLabel,
  });

  const allResults = [];
  let cityFailures = 0;

  try {
    const page = await context.newPage();
    const detailPage = await context.newPage();

    for (const [index, city] of runConfig.cities.entries()) {
      emit({
        type: 'city-started',
        city,
        index: index + 1,
        totalCities: runConfig.cities.length,
      });

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
        emit({
          type: 'city-completed',
          city,
          index: index + 1,
          totalCities: runConfig.cities.length,
          cityResultCount: cityResults.length,
          totalResultCount: allResults.length,
        });
      } catch (error) {
        cityFailures += 1;
        emit({
          type: 'city-failed',
          city,
          index: index + 1,
          totalCities: runConfig.cities.length,
          message: error.message,
        });
      }
    }
  } finally {
    await Promise.allSettled([
      context.close(),
      browser.close(),
    ]);
  }

  let finalResults = allResults;
  if (runConfig.enrichWebsite) {
    emit({
      type: 'enrichment-started',
      totalListings: allResults.length,
    });

    finalResults = await enrichListings(allResults, runConfig, {
      onEvent: emit,
    });
  }

  const baseFilename = `hostels-${timestampLabel()}`;
  const outputFiles = await writeOutputs(finalResults, {
    outputDir,
    baseFilename,
    formats: runConfig.formats,
  });

  const finishedAt = new Date();
  const summary = buildSummary({
    startedAt,
    finishedAt,
    runConfig,
    outputDir,
    cityFailures,
    totalResults: finalResults.length,
    outputFiles,
    launchSummary,
  });

  emit({
    type: 'run-completed',
    summary,
  });

  return {
    config: runConfig,
    summary,
    results: finalResults,
    outputFiles,
  };
}

function createEmitter(onEvent) {
  if (typeof onEvent !== 'function') {
    return () => {};
  }

  return (event) => {
    try {
      onEvent({
        timestamp: new Date().toISOString(),
        ...event,
      });
    } catch {
      // Ignore observer errors so the scraper can continue.
    }
  };
}

function buildSummary({ startedAt, finishedAt, runConfig, outputDir, cityFailures, totalResults, outputFiles, launchSummary }) {
  const totalCities = runConfig.cities.length;
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const outputDirectory = outputFiles[0]
    ? path.dirname(outputFiles[0])
    : path.resolve(outputDir);

  let outcome = 'success';
  if (cityFailures === totalCities) {
    outcome = 'failed';
  } else if (totalResults === 0) {
    outcome = 'empty';
  } else if (cityFailures > 0) {
    outcome = 'partial';
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
  return typeof value === 'string' && value.trim()
    ? value
    : defaultConfig.outputDir;
}
