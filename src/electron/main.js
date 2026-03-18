import path from 'node:path';
import process from 'node:process';
import { access, mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { defaultConfig } from '../config.js';
import { savePreferences, loadPreferences } from './preferences.js';
import { normalizeBoolean, normalizeBrowserChannel, normalizeFormats, normalizeInteger } from '../lib/run-options.js';
import { runScrape } from '../lib/run-scrape.js';
import { splitCities } from '../lib/utils.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..', '..');
const uiEntryPath = path.join(rootDir, 'src', 'ui', 'index.html');

let mainWindow;
let activeRunPromise = null;

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
    backgroundColor: '#f4efe5',
    title: 'KekaScraper',
    webPreferences: {
      preload: path.join(currentDir, 'preload.js'),
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

    return {
      formState: initialFormState,
      outputDirectory: getDesktopOutputDirectory(),
      supportsBundledChromium: !app.isPackaged,
      appVersion: app.getVersion(),
    };
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
    await savePreferences(app.getPath('userData'), formState);

    activeRunPromise = runScrape(
      buildRunConfig(formState),
      {
        onEvent: (event) => {
          sendScrapeEvent(event);
        },
      },
    );

    try {
      const result = await activeRunPromise;
      return {
        summary: result.summary,
        results: result.results,
        outputFiles: result.outputFiles,
      };
    } finally {
      activeRunPromise = null;
    }
  });

  ipcMain.handle('scrape:open-output-folder', async () => {
    await mkdir(getDesktopOutputDirectory(), { recursive: true });
    const result = await shell.openPath(getDesktopOutputDirectory());
    if (result) {
      throw new Error(result);
    }
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
    formats: ['json', 'csv'],
    browserChannel: defaultConfig.browserChannel,
    headful: !defaultConfig.headless,
    enrichWebsite: defaultConfig.enrichWebsite,
    websitePageLimit: defaultConfig.websitePageLimit,
  };
}

function normalizeStoredFormState(rawFormState = {}) {
  const fallbackState = getDefaultFormState();

  return {
    citiesText: normalizeStoredCitiesText(rawFormState.citiesText, fallbackState.citiesText),
    resultLimit: normalizeStoredInteger(rawFormState.resultLimit, fallbackState.resultLimit, 'resultLimit'),
    formats: normalizeFormats(rawFormState.formats),
    browserChannel: normalizeStoredBrowserChannel(rawFormState.browserChannel, fallbackState.browserChannel),
    headful: typeof rawFormState.headful === 'boolean' ? rawFormState.headful : fallbackState.headful,
    enrichWebsite:
      typeof rawFormState.enrichWebsite === 'boolean'
        ? rawFormState.enrichWebsite
        : fallbackState.enrichWebsite,
    websitePageLimit: normalizeStoredInteger(
      rawFormState.websitePageLimit,
      fallbackState.websitePageLimit,
      'websitePageLimit',
    ),
  };
}

function normalizeFormState(rawFormState = {}) {
  const citiesText = `${rawFormState.citiesText ?? ''}`.trim();
  const formats = normalizeFormats(rawFormState.formats);
  const browserChannel = normalizeBrowserChannel(
    rawFormState.browserChannel ?? defaultConfig.browserChannel,
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
    resultLimit: normalizeInteger(rawFormState.resultLimit, defaultConfig.resultLimit, 'resultLimit'),
    formats,
    browserChannel,
    headful: normalizeBoolean(rawFormState.headful, !defaultConfig.headless),
    enrichWebsite: normalizeBoolean(rawFormState.enrichWebsite, defaultConfig.enrichWebsite),
    websitePageLimit: normalizeInteger(
      rawFormState.websitePageLimit,
      defaultConfig.websitePageLimit,
      'websitePageLimit',
    ),
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
  };
}

function getDesktopOutputDirectory() {
  return path.join(app.getPath('documents'), 'KekaScraper', 'output');
}

function isSafeExternalUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function validateOutputFilePath(candidatePath) {
  if (!candidatePath) {
    return { ok: false, message: 'The requested file path is empty.' };
  }

  const outputDirectoryPath = getDesktopOutputDirectory();
  if (!await pathExists(outputDirectoryPath)) {
    return { ok: false, message: 'The output folder does not exist yet.' };
  }

  try {
    const outputDirectory = await realpath(outputDirectoryPath);
    const resolvedCandidate = await resolveCanonicalCandidatePath(candidatePath);
    const relativePath = path.relative(outputDirectory, resolvedCandidate);

    if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return { ok: false, message: 'The requested file is outside the allowed output directory.' };
    }

    if (!await pathExists(resolvedCandidate)) {
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
