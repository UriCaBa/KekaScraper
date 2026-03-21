import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultConfig } from '../config.js';
import { launchBrowser } from './browser.js';
import { writeOutputs } from './exporters.js';
import { scrapeCity } from './maps.js';
import { createRunEmitter, emitRunEvent, RUN_EVENT_TYPES } from './run-events.js';
import { enrichListings } from './website-enricher.js';
import { normalizeRunOptions } from './run-options.js';
import { atomicWriteJson, ensureDir, mapWithConcurrency, timestampLabel } from './utils.js';

export async function runScrape(inputOptions = {}, hooks = {}) {
  const emit = createRunEmitter(hooks.onEvent);
  const startedAt = new Date();
  const runConfig = normalizeRunOptions(inputOptions, { requireCities: true });
  const outputDir = normalizeOutputDir(runConfig.outputDir);
  const normalizedRunConfig = {
    ...runConfig,
    outputDir,
  };

  await ensureDir(outputDir);

  const checkpoint = normalizedRunConfig.resume ? await loadCheckpoint(outputDir, normalizedRunConfig.cities) : null;
  const completedCities = new Set(checkpoint?.completedCities ?? []);
  const allResults = [...(checkpoint?.results ?? [])];
  const runId = checkpoint?.runId ?? timestampLabel();
  const remainingCities = normalizedRunConfig.cities.filter((city) => !completedCities.has(city));

  if (checkpoint && completedCities.size > 0) {
    emitRunEvent(emit, RUN_EVENT_TYPES.RUN_STARTED, {
      startedAt: startedAt.toISOString(),
      cities: normalizedRunConfig.cities,
      outputDirectory: outputDir,
      resumed: true,
      resumedCities: completedCities.size,
      remainingCities: remainingCities.length,
    });
  } else {
    emitRunEvent(emit, RUN_EVENT_TYPES.RUN_STARTED, {
      startedAt: startedAt.toISOString(),
      cities: normalizedRunConfig.cities,
      outputDirectory: outputDir,
    });
  }

  const { browser, context, launchSummary } = await launchBrowser(normalizedRunConfig);
  emitRunEvent(emit, RUN_EVENT_TYPES.BROWSER_READY, {
    requestedBrowserChannel: normalizedRunConfig.browserChannel,
    selectedBrowserLabel: launchSummary.selectedCandidateLabel,
    proxyServer: normalizedRunConfig.proxy?.server ?? null,
  });

  let cityFailures = 0;
  let lastCheckpointTime = 0;
  let hasUnsavedProgress = false;
  const CHECKPOINT_INTERVAL_MS = 5000;
  const concurrency = Math.min(normalizedRunConfig.concurrency, remainingCities.length || 1);
  const totalCities = normalizedRunConfig.cities.length;

  const scrapeCityOptions = {
    queryPrefix: normalizedRunConfig.queryPrefix,
    resultLimit: normalizedRunConfig.resultLimit,
    maxScrollRounds: normalizedRunConfig.maxScrollRounds,
    retryCount: normalizedRunConfig.retryCount,
    retryDelayMs: normalizedRunConfig.retryDelayMs,
    detailPauseMs: normalizedRunConfig.detailPauseMs,
    coordinates: normalizedRunConfig.coordinates,
    detailConcurrency: normalizedRunConfig.detailConcurrency,
  };

  try {
    await mapWithConcurrency(remainingCities, concurrency, async (city) => {
      const cityIndex = normalizedRunConfig.cities.indexOf(city) + 1;
      const page = await context.newPage();
      const detailPage = await context.newPage();

      try {
        emitRunEvent(emit, RUN_EVENT_TYPES.CITY_STARTED, {
          city,
          index: cityIndex,
          totalCities,
        });

        const cityRun = await scrapeCity(page, detailPage, {
          ...scrapeCityOptions,
          city,
          onEvent: emit,
        });

        const cityCompleted = buildCityCompletedPayload({
          city,
          index: cityIndex,
          totalCities,
          cityRun,
          totalResultCount: allResults.length,
        });
        allResults.push(...cityCompleted.cityResults);
        completedCities.add(city);

        emitRunEvent(emit, RUN_EVENT_TYPES.CITY_COMPLETED, {
          city: cityCompleted.city,
          index: cityCompleted.index,
          totalCities: cityCompleted.totalCities,
          cityResultCount: cityCompleted.cityResultCount,
          totalResultCount: allResults.length,
          cityStats: cityCompleted.cityStats,
        });

        hasUnsavedProgress = true;
        const now = Date.now();
        const isLastCity = completedCities.size === totalCities;
        if (isLastCity || now - lastCheckpointTime >= CHECKPOINT_INTERVAL_MS) {
          await saveCheckpoint(outputDir, runId, completedCities, allResults, normalizedRunConfig);
          lastCheckpointTime = now;
          hasUnsavedProgress = false;
        }
      } catch (error) {
        cityFailures += 1;
        emitRunEvent(emit, RUN_EVENT_TYPES.CITY_FAILED, {
          city,
          index: cityIndex,
          totalCities,
          message: error.message,
        });
      } finally {
        await page.close().catch(() => {});
        await detailPage.close().catch(() => {});
      }
    });
  } finally {
    await Promise.allSettled([context.close(), browser.close()]);
  }

  // Save a final checkpoint only if cities completed since the last debounced save.
  // Skips redundant I/O when the last city already triggered a save via isLastCity.
  if (hasUnsavedProgress) {
    await saveCheckpoint(outputDir, runId, completedCities, allResults, normalizedRunConfig);
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

  if (cityFailures === 0) {
    await deleteCheckpoint(outputDir, runId);
  }

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

export function determineOutcome(cityFailures, totalCities, totalResults) {
  if (cityFailures === totalCities) return 'failed';
  if (totalResults === 0) return 'empty';
  if (cityFailures > 0) return 'partial';
  return 'success';
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

  const outcome = determineOutcome(cityFailures, totalCities, totalResults);

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

const CHECKPOINT_SUFFIX = '-checkpoint.json';

async function saveCheckpoint(outputDir, runId, completedCities, results, config) {
  try {
    const filePath = path.join(outputDir, `${runId}${CHECKPOINT_SUFFIX}`);
    await atomicWriteJson(filePath, {
      runId,
      cities: config.cities,
      completedCities: [...completedCities],
      results,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Checkpoint save failure is non-fatal — scraping continues.
  }
}

export async function loadCheckpoint(outputDir, expectedCities) {
  const entries = await fs.readdir(outputDir).catch(() => []);
  const checkpointFiles = entries
    .filter((entry) => entry.endsWith(CHECKPOINT_SUFFIX))
    .sort()
    .reverse();

  for (const filename of checkpointFiles) {
    try {
      const filePath = path.join(outputDir, filename);
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));

      if (!data.runId || !Array.isArray(data.completedCities) || !Array.isArray(data.results)) {
        continue;
      }

      const resultsValid = data.results.every(
        (r) => r !== null && typeof r === 'object' && !Array.isArray(r) && typeof r.name === 'string',
      );
      if (!resultsValid) {
        console.warn(`[checkpoint] Corrupted results in ${filename}, skipping.`);
        continue;
      }

      if (expectedCities && Array.isArray(data.cities)) {
        const stored = [...data.cities].sort().join('\0');
        const expected = [...expectedCities].sort().join('\0');
        if (stored !== expected) {
          continue;
        }
      }

      return {
        runId: data.runId,
        completedCities: data.completedCities,
        results: data.results,
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function deleteCheckpoint(outputDir, runId) {
  try {
    await fs.unlink(path.join(outputDir, `${runId}${CHECKPOINT_SUFFIX}`));
  } catch {
    // Checkpoint cleanup failure is non-fatal.
  }
}
