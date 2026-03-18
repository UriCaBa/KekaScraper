import { RUN_EVENT_TYPES } from '../lib/run-events.js';
import { countUniqueCities, normalizePublicUrl } from '../shared/input-normalization.js';

const state = {
  initialized: false,
  outputDirectory: '',
  running: false,
  formDisabled: false,
  totalResults: 0,
  completedCities: 0,
  totalCities: 0,
  logs: [],
  results: [],
  outputFiles: [],
  lastCompletedSummary: null,
};

const RESULTS_PREVIEW_LIMIT = 200;

const elements = {
  form: document.querySelector('#scrape-form'),
  cities: document.querySelector('#cities'),
  resultLimit: document.querySelector('#result-limit'),
  websitePageLimit: document.querySelector('#website-page-limit'),
  browserChannel: document.querySelector('#browser-channel'),
  browserChannelHelp: document.querySelector('#browser-channel-help'),
  enrichWebsite: document.querySelector('#enrich-website'),
  headful: document.querySelector('#headful'),
  formatCheckboxes: [...document.querySelectorAll('input[name="formats"]')],
  runButton: document.querySelector('#run-button'),
  openOutputFolderButton: document.querySelector('#open-output-folder'),
  outputDirectory: document.querySelector('#output-directory'),
  appVersion: document.querySelector('#app-version'),
  statusCopy: document.querySelector('#status-copy'),
  statusPhase: document.querySelector('#status-phase'),
  statusResults: document.querySelector('#status-results'),
  statusCities: document.querySelector('#status-cities'),
  activityLog: document.querySelector('#activity-log'),
  resultsEmpty: document.querySelector('#results-empty'),
  resultsContent: document.querySelector('#results-content'),
  resultsSummary: document.querySelector('#results-summary'),
  resultsTableBody: document.querySelector('#results-table-body'),
  outputFiles: document.querySelector('#output-files'),
};

elements.runButton.disabled = true;
elements.runButton.textContent = 'Loading...';
elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.initialized || state.formDisabled) {
    return;
  }

  void handleSubmit();
});

bootstrap().catch((error) => {
  appendLog(`Failed to load the app: ${error.message}`, 'error');
  elements.statusCopy.textContent = error.message;
  elements.statusPhase.textContent = 'Error';
  renderStatus();
});

async function bootstrap() {
  const initialData = await window.kekaApp.getDefaults();
  state.outputDirectory = initialData.outputDirectory;
  const initialFormState = { ...initialData.formState };

  elements.outputDirectory.textContent = initialData.outputDirectory;
  elements.appVersion.textContent = initialData.appVersion;
  configureBrowserOptions(initialData.supportsBundledChromium, initialFormState);
  populateForm(initialFormState);
  renderResults();
  renderStatus();
  for (const checkbox of elements.formatCheckboxes) {
    checkbox.addEventListener('change', syncFormatSelection);
  }

  elements.openOutputFolderButton.addEventListener('click', async () => {
    if (state.outputDirectory) {
      await runUiAction(
        () => window.kekaApp.openOutputFolder(),
        'Failed to open the output folder',
      );
    }
  });

  window.kekaApp.onScrapeEvent((event) => {
    handleScrapeEvent(event);
  });

  state.initialized = true;
  setFormDisabled(false);
}

async function handleSubmit() {
  let payload;
  try {
    payload = readFormState();
  } catch (error) {
    appendLog(error.message, 'error');
    elements.statusCopy.textContent = error.message;
    elements.statusPhase.textContent = 'Error';
    renderStatus();
    return;
  }

  state.running = true;
  state.logs = [];
  state.results = [];
  state.outputFiles = [];
  state.lastCompletedSummary = null;
  state.totalResults = 0;
  state.completedCities = 0;
  state.totalCities = countCities(payload.citiesText);
  renderStatus();
  renderResults();
  setFormDisabled(true);
  appendLog(`Preparing a run for ${state.totalCities} ${state.totalCities === 1 ? 'city' : 'cities'}.`);
  renderStatus();

  try {
    const result = await window.kekaApp.startScrape(payload);
    state.results = result.previewResults ?? (result.results ?? []).slice(0, RESULTS_PREVIEW_LIMIT);
    state.outputFiles = result.outputFiles;
    state.lastCompletedSummary = result.summary;
    state.outputDirectory = result.summary.outputDirectory;
    state.totalResults = result.summary.totalResults;
    state.completedCities = result.summary.totalCities;
    state.totalCities = result.summary.totalCities;
    elements.outputDirectory.textContent = result.summary.outputDirectory;
    appendLog(buildCompletionMessage(result.summary));
  } catch (error) {
    appendLog(error.message, 'error');
    elements.statusCopy.textContent = error.message;
    elements.statusPhase.textContent = 'Error';
  } finally {
    state.running = false;
    setFormDisabled(false);
    renderStatus();
    renderResults();
  }
}

function handleScrapeEvent(event) {
  switch (event.type) {
    case RUN_EVENT_TYPES.RUN_STARTED:
      state.totalCities = event.cities.length;
      elements.statusPhase.textContent = 'Launching';
      elements.statusCopy.textContent = `Starting a local scrape. Files will be written to ${event.outputDirectory}.`;
      appendLog(`Starting local scrape. Output folder: ${event.outputDirectory}`);
      break;
    case RUN_EVENT_TYPES.BROWSER_READY:
      elements.statusPhase.textContent = 'Scraping';
      appendLog(`Browser ready: ${event.selectedBrowserLabel} (requested: ${event.requestedBrowserChannel}).`);
      break;
    case RUN_EVENT_TYPES.CITY_STARTED:
      elements.statusPhase.textContent = 'Scraping';
      elements.statusCopy.textContent = `Searching Google Maps for ${event.city}.`;
      appendLog(`City ${event.index}/${event.totalCities}: ${event.city}`);
      break;
    case RUN_EVENT_TYPES.CITY_SEARCH_RESULTS:
      appendLog(`${event.city}: found ${event.candidateCount} candidate Google Maps URLs.`);
      break;
    case RUN_EVENT_TYPES.RETRYING:
      appendLog(`Retrying ${event.label}: ${event.message}`, 'error');
      break;
    case RUN_EVENT_TYPES.CITY_COMPLETED:
      state.completedCities = event.index;
      state.totalResults = event.totalResultCount;
      elements.statusCopy.textContent = `${event.city} completed with ${event.cityResultCount} matches.`;
      appendLog(
        `${event.city} completed. ${event.cityResultCount} matches kept, ${event.totalResultCount} total so far.`,
      );
      break;
    case RUN_EVENT_TYPES.LISTING_FAILED:
      appendLog(`Listing failed for ${event.city}: ${event.message}`, 'error');
      break;
    case RUN_EVENT_TYPES.CITY_FAILED:
      state.completedCities = event.index;
      appendLog(`${event.city} failed: ${event.message}`, 'error');
      elements.statusCopy.textContent = `${event.city} failed, but the run is continuing.`;
      break;
    case RUN_EVENT_TYPES.ENRICHMENT_STARTED:
      elements.statusPhase.textContent = 'Enriching';
      elements.statusCopy.textContent = `Checking ${event.totalListings} hostel websites for public contact details.`;
      appendLog(`Starting website enrichment for ${event.totalListings} listings.`);
      break;
    case RUN_EVENT_TYPES.ENRICHMENT_ITEM_STARTED:
      appendLog(`Enriching ${event.index}/${event.totalListings}: ${event.name ?? event.website ?? 'listing'}.`);
      break;
    case RUN_EVENT_TYPES.ENRICHMENT_ITEM_SKIPPED:
      appendLog(`Skipping website enrichment for ${event.name ?? event.website ?? 'listing'} (${event.reason}).`);
      break;
    case RUN_EVENT_TYPES.ENRICHMENT_ITEM_COMPLETED:
      appendLog(`Website enrichment finished for ${event.name ?? event.website ?? 'listing'}.`);
      break;
    case RUN_EVENT_TYPES.ENRICHMENT_ITEM_FAILED:
      appendLog(`Website enrichment failed for ${event.name ?? event.website ?? 'listing'}: ${event.message}`, 'error');
      break;
    case RUN_EVENT_TYPES.WEBSITE_PAGE_SKIPPED:
      appendLog(`Skipping subpage ${event.url}: ${event.message}`, 'error');
      break;
    case RUN_EVENT_TYPES.RUN_COMPLETED:
      state.totalResults = event.summary.totalResults;
      state.completedCities = event.summary.totalCities;
      elements.statusPhase.textContent = 'Completed';
      elements.statusCopy.textContent = `Finished with ${event.summary.totalResults} rows in ${formatDuration(event.summary.durationMs)}.`;
      break;
    default:
      break;
  }

  renderStatus();
}

function renderStatus() {
  if (!state.initialized && state.logs.length === 0) {
    elements.statusCopy.textContent = 'Loading local defaults...';
    elements.statusPhase.textContent = 'Loading';
  } else if (!state.running && state.logs.length === 0) {
    elements.statusCopy.textContent = 'Ready to start.';
    elements.statusPhase.textContent = 'Idle';
  }

  elements.statusResults.textContent = `${state.totalResults}`;
  elements.statusCities.textContent = `${state.completedCities} / ${state.totalCities}`;
  renderActivityLog();

  elements.openOutputFolderButton.disabled = !state.outputDirectory;
}

function renderResults() {
  const hasCompletedRun = Boolean(state.lastCompletedSummary);
  elements.resultsEmpty.hidden = hasCompletedRun;
  elements.resultsContent.hidden = !hasCompletedRun;

  if (!hasCompletedRun) {
    elements.resultsTableBody.replaceChildren();
    elements.outputFiles.replaceChildren();
    elements.resultsSummary.textContent = '0 rows';
    return;
  }

  const rowCount = state.lastCompletedSummary.totalResults;
  const previewCount = state.results.length;
  const previewLabel = rowCount > previewCount
    ? `, showing first ${previewCount}`
    : '';
  elements.resultsSummary.textContent = `${rowCount} ${rowCount === 1 ? 'row' : 'rows'}${previewLabel}`;
  renderResultRows();
  renderOutputFiles();
}

function populateForm(formState) {
  elements.cities.value = formState.citiesText ?? '';
  elements.resultLimit.value = formState.resultLimit ?? 20;
  elements.websitePageLimit.value = formState.websitePageLimit ?? 8;
  elements.browserChannel.value = formState.browserChannel ?? 'auto';
  elements.enrichWebsite.checked = formState.enrichWebsite !== false;
  elements.headful.checked = Boolean(formState.headful);

  const selectedFormats = new Set(formState.formats ?? ['json', 'csv']);
  for (const checkbox of elements.formatCheckboxes) {
    checkbox.checked = selectedFormats.has(checkbox.value);
  }

  syncFormatSelection();
}

function configureBrowserOptions(supportsBundledChromium, formState) {
  const chromiumOption = elements.browserChannel.querySelector('option[value="chromium"]');

  if (!supportsBundledChromium && chromiumOption) {
    chromiumOption.remove();
    if (formState.browserChannel === 'chromium') {
      formState.browserChannel = 'auto';
    }

    elements.browserChannelHelp.textContent = 'Packaged desktop builds currently use Auto, Edge, or Chrome.';
    return;
  }

  elements.browserChannelHelp.textContent = 'Auto tries Edge, then Chrome, then bundled Chromium.';
}

function readFormState() {
  const selectedFormats = elements.formatCheckboxes
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);
  const citiesText = elements.cities.value;
  const totalCities = countCities(citiesText);

  if (selectedFormats.length === 0) {
    throw new Error('Select at least one output format before starting the scrape.');
  }

  if (totalCities === 0) {
    throw new Error('Add at least one valid city before starting the scrape.');
  }

  return {
    citiesText,
    resultLimit: elements.resultLimit.value,
    websitePageLimit: elements.websitePageLimit.value,
    browserChannel: elements.browserChannel.value,
    enrichWebsite: elements.enrichWebsite.checked,
    headful: elements.headful.checked,
    formats: selectedFormats,
  };
}

function setFormDisabled(disabled) {
  state.formDisabled = disabled;

  for (const element of [
    elements.cities,
    elements.resultLimit,
    elements.websitePageLimit,
    elements.browserChannel,
    elements.enrichWebsite,
    elements.headful,
    ...elements.formatCheckboxes,
  ]) {
    element.disabled = disabled;
  }

  elements.runButton.disabled = disabled || !state.initialized;
  elements.runButton.textContent = disabled ? 'Running...' : state.initialized ? 'Start scrape' : 'Loading...';
  syncFormatSelection();
}

function appendLog(message, tone = 'info') {
  state.logs = [
    ...state.logs,
    { message, tone },
  ].slice(-120);
}

async function runUiAction(action, failureLabel) {
  try {
    await action();
  } catch (error) {
    const message = error?.message ?? failureLabel;
    appendLog(`${failureLabel}: ${message}`, 'error');
    elements.statusCopy.textContent = message;
    elements.statusPhase.textContent = 'Error';
    renderStatus();
  }
}

function buildCompletionMessage(summary) {
  const fileCount = summary.outputFiles.length;
  return `Run ${summary.outcome}. ${summary.totalResults} rows exported to ${fileCount} ${fileCount === 1 ? 'file' : 'files'}.`;
}

function countCities(citiesText) {
  return countUniqueCities(citiesText);
}

function formatDuration(durationMs) {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function sanitizeExternalUrl(value) {
  return normalizePublicUrl(value);
}

function syncFormatSelection() {
  if (state.formDisabled) {
    for (const checkbox of elements.formatCheckboxes) {
      checkbox.disabled = true;
    }
    return;
  }

  const checkedCount = elements.formatCheckboxes.filter((checkbox) => checkbox.checked).length;
  const lastChecked = checkedCount === 1
    ? elements.formatCheckboxes.find((checkbox) => checkbox.checked)
    : null;

  for (const checkbox of elements.formatCheckboxes) {
    checkbox.disabled = checkedCount === 1 && checkbox === lastChecked;
  }
}

function renderResultRows() {
  const fragment = document.createDocumentFragment();

  for (const item of state.results) {
    const row = document.createElement('tr');
    row.append(
      createTextCell(item.name),
      createTextCell(item.searchedCity),
      createWebsiteCell(item.website),
      createTextCell(item.generalEmail),
      createTextCell(item.bestContactChannel),
      createTextCell(item.bestContactValue),
    );
    fragment.append(row);
  }

  elements.resultsTableBody.replaceChildren(fragment);
}

function renderActivityLog() {
  const fragment = document.createDocumentFragment();

  for (const entry of state.logs) {
    const item = document.createElement('li');
    item.className = entry.tone;
    item.textContent = entry.message;
    fragment.append(item);
  }

  elements.activityLog.replaceChildren(fragment);
}

function renderOutputFiles() {
  const fragment = document.createDocumentFragment();

  for (const filePath of state.outputFiles) {
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary output-file';
    button.textContent = fileName;
    button.addEventListener('click', async () => {
      await runUiAction(
        () => window.kekaApp.openOutputFile(filePath),
        `Failed to open ${fileName}`,
      );
    });
    fragment.append(button);
  }

  elements.outputFiles.replaceChildren(fragment);
}

function createTextCell(value) {
  const cell = document.createElement('td');
  cell.textContent = `${value ?? ''}`;
  return cell;
}

function createWebsiteCell(url) {
  const cell = document.createElement('td');
  const safeUrl = sanitizeExternalUrl(url);
  if (!safeUrl) {
    return cell;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary external-link';
  button.textContent = safeUrl;
  button.addEventListener('click', async () => {
    await runUiAction(
      () => window.kekaApp.openExternalUrl(safeUrl),
      `Failed to open ${safeUrl}`,
    );
  });
  cell.append(button);
  return cell;
}
