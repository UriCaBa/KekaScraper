import path from 'node:path';
import process from 'node:process';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { defaultConfig } from '../config.js';
import { savePreferences, loadPreferences } from './preferences.js';
import { normalizeBoolean, normalizeBrowserChannel, normalizeFormats, normalizeInteger } from '../lib/run-options.js';
import { RUN_EVENT_TYPES } from '../lib/run-events.js';
import { runScrape } from '../lib/run-scrape.js';
import { splitCities } from '../lib/utils.js';
import { hasUrlCredentials } from '../shared/input-normalization.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..');
const uiEntryPath = path.join(rootDir, 'src', 'ui', 'index.html');
const isSmokeMode = process.env.KEKA_SMOKE_MODE === '1';

let mainWindow;
let activeRunPromise = null;
let userOutputDirectory = null;
const RESULTS_PREVIEW_LIMIT = 200;

app.whenReady().then(async () => {
  registerIpcHandlers();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: '#09090b',
    title: 'KekaScraper by Orical Labs',
    webPreferences: {
      preload: path.join(currentDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url);
      }
    }
  });

  window.loadFile(uiEntryPath);
  return window;
}

function registerIpcHandlers() {
  ipcMain.handle('app:get-defaults', async () => {
    const initialFormState = normalizeStoredFormState(
      await loadPreferences(app.getPath('userData'), getDefaultFormState()),
    );

    if (initialFormState.outputDir) {
      userOutputDirectory = initialFormState.outputDir;
    }

    return {
      formState: initialFormState,
      outputDirectory: getDesktopOutputDirectory(),
      supportsBundledChromium: !app.isPackaged,
      appVersion: defaultConfig.appVersion,
    };
  });

  ipcMain.handle('app:pick-output-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose output folder',
      defaultPath: getDesktopOutputDirectory(),
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths.length) {
      return null;
    }

    const pickedPath = result.filePaths[0];
    userOutputDirectory = pickedPath;

    const currentPrefs = await loadPreferences(app.getPath('userData'), getDefaultFormState());
    await savePreferences(app.getPath('userData'), { ...currentPrefs, outputDir: pickedPath });

    return pickedPath;
  });

  ipcMain.handle('app:open-external-url', async (_, url) => {
    if (!isSafeExternalUrl(url)) {
      throw new Error('Only http and https links can be opened.');
    }

    await shell.openExternal(url);
  });

  ipcMain.handle('scrape:start', async (_, rawFormState) => {
    if (activeRunPromise) {
      throw new Error('A scrape is already running. Wait for it to finish before starting another one.');
    }

    const formState = normalizeFormState(rawFormState);
    await savePreferences(app.getPath('userData'), {
      ...formState,
      proxy: sanitizeProxyForStorage(formState.proxy),
      outputDir: userOutputDirectory ?? '',
    });

    activeRunPromise = startDesktopScrape(buildRunConfig(formState));

    try {
      const result = await activeRunPromise;
      return {
        summary: result.summary,
        previewResults: result.results.slice(0, RESULTS_PREVIEW_LIMIT),
        outputFiles: result.outputFiles,
      };
    } finally {
      activeRunPromise = null;
    }
  });

  ipcMain.handle('scrape:open-output-folder', async () => {
    const dir = getDesktopOutputDirectory();

    if (typeof dir !== 'string' || dir.trim().length === 0) {
      throw new Error('Output directory path is empty.');
    }

    if (!path.isAbsolute(dir)) {
      throw new Error('Output directory path must be absolute.');
    }

    try {
      const dirStat = await stat(dir);
      if (!dirStat.isDirectory()) {
        throw new Error('Output path exists but is not a directory.');
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error('Output directory does not exist yet. Run a scrape first to create it.', { cause: error });
      }
      throw error;
    }

    const result = await shell.openPath(dir);
    if (result) {
      throw new Error(result);
    }
  });

  ipcMain.handle('app:load-results-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Load previous results',
      defaultPath: getDesktopOutputDirectory(),
      filters: [{ name: 'JSON files', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (result.canceled || !result.filePaths.length) {
      return null;
    }

    const filePath = result.filePaths[0];
    const raw = await readFile(filePath, 'utf8');
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('The selected file is not valid JSON.');
    }

    if (!Array.isArray(parsed)) {
      throw new Error('The selected file does not contain a results array.');
    }

    const items = parsed.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (items.length === 0) {
      throw new Error('The selected file contains no valid result entries.');
    }

    return {
      filePath,
      fileName: path.basename(filePath),
      results: items,
      totalCount: items.length,
    };
  });

  ipcMain.handle('scrape:open-output-file', async (_, filePath) => {
    const outputFileCheck = await validateOutputFilePath(filePath);
    if (!outputFileCheck.ok) {
      throw new Error(outputFileCheck.message);
    }

    const result = await shell.openPath(outputFileCheck.canonicalPath);
    if (result) {
      throw new Error(result);
    }
  });
}

function getDefaultFormState() {
  return {
    citiesText: '',
    resultLimit: defaultConfig.resultLimit,
    formats: [...defaultConfig.formats],
    browserChannel: defaultConfig.browserChannel,
    headful: !defaultConfig.headless,
    enrichWebsite: defaultConfig.enrichWebsite,
    websitePageLimit: defaultConfig.websitePageLimit,
    concurrency: 1,
    detailConcurrency: 1,
    proxy: '',
    outputDir: '',
  };
}

function normalizeStoredFormState(rawFormState = {}) {
  const storedFormState = asPlainObject(rawFormState);
  const fallbackState = getDefaultFormState();

  return {
    citiesText: normalizeStoredCitiesText(storedFormState.citiesText, fallbackState.citiesText),
    resultLimit: normalizeStoredInteger(storedFormState.resultLimit, fallbackState.resultLimit, 'resultLimit'),
    formats: normalizeFormats(storedFormState.formats),
    browserChannel: normalizeStoredBrowserChannel(storedFormState.browserChannel, fallbackState.browserChannel),
    headful: typeof storedFormState.headful === 'boolean' ? storedFormState.headful : fallbackState.headful,
    enrichWebsite:
      typeof storedFormState.enrichWebsite === 'boolean' ? storedFormState.enrichWebsite : fallbackState.enrichWebsite,
    websitePageLimit: normalizeStoredInteger(
      storedFormState.websitePageLimit,
      fallbackState.websitePageLimit,
      'websitePageLimit',
    ),
    concurrency: normalizeStoredInteger(storedFormState.concurrency, fallbackState.concurrency, 'concurrency'),
    detailConcurrency: normalizeStoredInteger(
      storedFormState.detailConcurrency,
      fallbackState.detailConcurrency,
      'detailConcurrency',
    ),
    proxy: typeof storedFormState.proxy === 'string' ? storedFormState.proxy.trim() : fallbackState.proxy,
    outputDir:
      typeof storedFormState.outputDir === 'string' ? storedFormState.outputDir.trim() : fallbackState.outputDir,
  };
}

function normalizeFormState(rawFormState = {}) {
  const formState = asPlainObject(rawFormState);
  const citiesText = `${formState.citiesText ?? ''}`.trim();
  const formats = normalizeFormats(formState.formats);
  const browserChannel = normalizeBrowserChannel(
    formState.browserChannel ?? defaultConfig.browserChannel,
    'browser channel',
  );

  if (!citiesText) {
    throw new Error('Add at least one city before starting the scrape.');
  }

  if (splitCities([citiesText]).length === 0) {
    throw new Error('Add at least one valid city before starting the scrape.');
  }

  if (app.isPackaged && browserChannel === 'chromium') {
    throw new Error('Packaged desktop builds currently require Auto, Microsoft Edge, or Google Chrome.');
  }

  return {
    citiesText,
    resultLimit: normalizeInteger(formState.resultLimit, defaultConfig.resultLimit, 'resultLimit'),
    formats,
    browserChannel,
    headful: normalizeBoolean(formState.headful, !defaultConfig.headless),
    enrichWebsite: normalizeBoolean(formState.enrichWebsite, defaultConfig.enrichWebsite),
    websitePageLimit: normalizeInteger(formState.websitePageLimit, defaultConfig.websitePageLimit, 'websitePageLimit'),
    concurrency: normalizeInteger(formState.concurrency, 1, 'concurrency', { min: 1 }),
    detailConcurrency: normalizeInteger(formState.detailConcurrency, 1, 'detailConcurrency', { min: 1 }),
    proxy: typeof formState.proxy === 'string' ? formState.proxy.trim() : '',
  };
}

function normalizeStoredBrowserChannel(value, fallbackValue) {
  try {
    const normalizedValue = normalizeBrowserChannel(value ?? fallbackValue, 'browser channel');
    if (app.isPackaged && normalizedValue === 'chromium') {
      return fallbackValue;
    }

    return normalizedValue;
  } catch {
    return fallbackValue;
  }
}

function normalizeStoredCitiesText(value, fallbackValue) {
  if (typeof value !== 'string') {
    return fallbackValue;
  }

  return splitCities([value]).join('\n');
}

function normalizeStoredInteger(value, fallbackValue, flagName) {
  try {
    return normalizeInteger(value, fallbackValue, flagName);
  } catch {
    return fallbackValue;
  }
}

function buildRunConfig(formState) {
  return {
    cities: formState.citiesText,
    resultLimit: formState.resultLimit,
    formats: formState.formats,
    browserChannel: formState.browserChannel,
    headless: !formState.headful,
    enrichWebsite: formState.enrichWebsite,
    websitePageLimit: formState.websitePageLimit,
    outputDir: getDesktopOutputDirectory(),
    allowBundledChromium: !app.isPackaged,
    concurrency: formState.concurrency,
    detailConcurrency: formState.detailConcurrency,
    proxy: formState.proxy || undefined,
  };
}

function startDesktopScrape(runConfig) {
  if (isSmokeMode) {
    return runSmokeScrape(runConfig);
  }

  return runScrape(runConfig, {
    onEvent: (event) => {
      sendScrapeEvent(event);
    },
  });
}

function getDesktopOutputDirectory() {
  return userOutputDirectory || path.join(app.getPath('documents'), 'KekaScraper', 'output');
}

function isSafeExternalUrl(value) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !hasUrlCredentials(parsed);
  } catch {
    return false;
  }
}

async function validateOutputFilePath(candidatePath) {
  if (typeof candidatePath !== 'string' || candidatePath.trim().length === 0) {
    return { ok: false, message: 'The requested file path is empty.' };
  }

  const outputDirectoryPath = getDesktopOutputDirectory();
  if (!(await pathExists(outputDirectoryPath))) {
    return { ok: false, message: 'The output folder does not exist yet.' };
  }

  try {
    const outputDirectory = await realpath(outputDirectoryPath);
    const resolvedCandidate = await resolveCanonicalCandidatePath(candidatePath);
    const relativePath = path.relative(outputDirectory, resolvedCandidate);

    if (
      relativePath === '' ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      return { ok: false, message: 'The requested file is outside the allowed output directory.' };
    }

    if (!(await pathExists(resolvedCandidate))) {
      return { ok: false, message: 'The requested output file no longer exists.' };
    }

    return { ok: true, canonicalPath: resolvedCandidate };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: false, message: 'The requested output file no longer exists.' };
    }

    throw error;
  }
}

function sendScrapeEvent(event) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }

  try {
    mainWindow.webContents.send('scrape:event', event);
  } catch {
    // Ignore renderer delivery failures while a scrape continues in the main process.
  }
}

async function resolveCanonicalCandidatePath(candidatePath) {
  const resolvedCandidatePath = path.resolve(candidatePath);

  try {
    return await realpath(resolvedCandidatePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }

    const parentDirectory = await realpath(path.dirname(resolvedCandidatePath));
    return path.join(parentDirectory, path.basename(resolvedCandidatePath));
  }
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeProxyForStorage(raw) {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return '';
  }
}

function asPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
}

async function runSmokeScrape(runConfig) {
  const startedAt = new Date();
  const cities = splitCities([runConfig.cities]);
  const outputDirectory = runConfig.outputDir;
  const outputFiles = runConfig.formats.map((format) => path.join(outputDirectory, `hostels-smoke.${format}`));
  const results = cities.slice(0, Math.max(1, Math.min(2, runConfig.resultLimit))).map((city, index) => ({
    name: `Smoke Hostel ${index + 1}`,
    searchedCity: city,
    website: `https://example-${index + 1}.test`,
    generalEmail: `hello${index + 1}@example-${index + 1}.test`,
    bestContactChannel: 'general-email',
    bestContactValue: `hello${index + 1}@example-${index + 1}.test`,
  }));

  sendScrapeEvent({
    type: RUN_EVENT_TYPES.RUN_STARTED,
    startedAt: startedAt.toISOString(),
    cities,
    outputDirectory,
  });
  sendScrapeEvent({
    type: RUN_EVENT_TYPES.BROWSER_READY,
    requestedBrowserChannel: runConfig.browserChannel,
    selectedBrowserLabel: 'Smoke Browser',
  });

  for (const [index, city] of cities.entries()) {
    sendScrapeEvent({
      type: RUN_EVENT_TYPES.CITY_STARTED,
      city,
      index: index + 1,
      totalCities: cities.length,
    });
    sendScrapeEvent({
      type: RUN_EVENT_TYPES.CITY_COMPLETED,
      city,
      index: index + 1,
      totalCities: cities.length,
      cityResultCount: results.filter((item) => item.searchedCity === city).length,
      totalResultCount: results.length,
    });
  }

  if (runConfig.enrichWebsite) {
    sendScrapeEvent({
      type: RUN_EVENT_TYPES.ENRICHMENT_STARTED,
      totalListings: results.length,
    });
  }

  const finishedAt = new Date(startedAt.getTime() + 1200);
  const summary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    totalCities: cities.length,
    cityFailures: 0,
    totalResults: results.length,
    outcome: results.length > 0 ? 'success' : 'empty',
    exitCode: 0,
    outputFiles,
    outputDirectory,
    selectedBrowserLabel: 'Smoke Browser',
    requestedBrowserChannel: runConfig.browserChannel,
    enrichWebsite: runConfig.enrichWebsite,
  };

  sendScrapeEvent({
    type: RUN_EVENT_TYPES.RUN_COMPLETED,
    summary,
  });

  return {
    summary,
    results,
    outputFiles,
  };
}
