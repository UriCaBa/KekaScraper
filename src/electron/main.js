import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { defaultConfig } from '../config.js';
import { savePreferences, loadPreferences } from './preferences.js';
import { normalizeBrowserChannel, normalizeFormats, normalizeInteger } from '../lib/run-options.js';
import { runScrape } from '../lib/run-scrape.js';

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
    },
  });

  window.loadFile(uiEntryPath);
  return window;
}

function registerIpcHandlers() {
  ipcMain.handle('app:get-defaults', async () => {
    const initialFormState = await loadPreferences(app.getPath('userData'), getDefaultFormState());

    return {
      formState: initialFormState,
      outputDirectory: getDesktopOutputDirectory(),
      appVersion: app.getVersion(),
    };
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
          mainWindow?.webContents.send('scrape:event', event);
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

  ipcMain.handle('scrape:open-output-folder', async (_, folderPath) => {
    return shell.openPath(folderPath);
  });

  ipcMain.handle('scrape:open-output-file', async (_, filePath) => {
    return shell.openPath(filePath);
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

function normalizeFormState(rawFormState = {}) {
  const citiesText = `${rawFormState.citiesText ?? ''}`.trim();
  const formats = normalizeFormats(rawFormState.formats);
  if (!citiesText) {
    throw new Error('Add at least one city before starting the scrape.');
  }

  return {
    citiesText,
    resultLimit: normalizeInteger(rawFormState.resultLimit, defaultConfig.resultLimit, 'resultLimit'),
    formats,
    browserChannel: normalizeBrowserChannel(
      rawFormState.browserChannel ?? defaultConfig.browserChannel,
      'browser channel',
    ),
    headful: Boolean(rawFormState.headful),
    enrichWebsite: rawFormState.enrichWebsite !== false,
    websitePageLimit: normalizeInteger(
      rawFormState.websitePageLimit,
      defaultConfig.websitePageLimit,
      'websitePageLimit',
    ),
  };
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
  };
}

function getDesktopOutputDirectory() {
  return path.join(app.getPath('documents'), 'KekaScraper', 'output');
}
