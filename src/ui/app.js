import { RUN_EVENT_TYPES } from '../lib/run-events.js';
import { countUniqueCities, normalizePublicUrl } from '../shared/input-normalization.js';
import {
  buildCompletionMessage as formatCompletionMessage,
  deriveResultsView,
  deriveRunButtonView,
  deriveStatusView,
  formatDuration as formatRunDuration,
} from './view-model.js';

const state = {
  initialized: false,
  bootstrapFailed: false,
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
  concurrency: document.querySelector('#concurrency'),
  detailConcurrency: document.querySelector('#detail-concurrency'),
  proxy: document.querySelector('#proxy'),
};

elements.runButton.disabled = true;
elements.runButton.textContent = 'Loading...';
setFormDisabled(true);
elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (state.bootstrapFailed) {
    window.location.reload();
    return;
  }

  if (!state.initialized || state.formDisabled) {
    return;
  }

  void handleSubmit();
});

bootstrap().catch((error) => {
  state.bootstrapFailed = true;
  const message = error?.message ?? String(error);
  appendLog(`Failed to load the app: ${message}`, 'error');
  elements.statusCopy.textContent = message;
  elements.statusPhase.textContent = 'Error';
  renderRunButton();
  renderStatus();
});

async function bootstrap() {
  const bridge = getBridge();
  const initialData = await bridge.getDefaults();
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
      await runUiAction(() => bridge.openOutputFolder(), 'Failed to open the output folder');
    }
  });

  bridge.onScrapeEvent((event) => {
    handleScrapeEvent(event);
  });

  state.initialized = true;
  state.bootstrapFailed = false;
  setFormDisabled(false);
  renderStatus();
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
    const result = await getBridge().startScrape(payload);
    state.results = result.previewResults ?? (result.results ?? []).slice(0, RESULTS_PREVIEW_LIMIT);
    state.outputFiles = result.outputFiles;
    state.lastCompletedSummary = result.summary;
    state.outputDirectory = result.summary.outputDirectory;
    state.totalResults = result.summary.totalResults;
    state.completedCities = result.summary.totalCities;
    state.totalCities = result.summary.totalCities;
    elements.outputDirectory.textContent = result.summary.outputDirectory;
    appendLog(formatCompletionMessage(result.summary));
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
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
    return;
  }

  switch (event.type) {
    case RUN_EVENT_TYPES.RUN_STARTED:
      state.totalCities = Array.isArray(event.cities) ? event.cities.length : 0;
      elements.statusPhase.textContent = 'Launching';
      elements.statusCopy.textContent = `Starting a local scrape. Files will be written to ${event.outputDirectory ?? state.outputDirectory}.`;
      appendLog(`Starting local scrape. Output folder: ${event.outputDirectory ?? state.outputDirectory}`);
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
      if (typeof event.aggregatedCandidateCount === 'number') {
        appendLog(
          `${event.city}: found ${event.candidateCount} candidate Google Maps URLs (${event.aggregatedCandidateCount} unique total so far).`,
        );
      } else {
        appendLog(`${event.city}: found ${event.candidateCount} candidate Google Maps URLs.`);
      }
      break;
    case RUN_EVENT_TYPES.LISTING_SKIPPED:
      appendLog(`Skipping ${event.name ?? event.listingUrl ?? 'listing'} (${formatListingSkipReason(event)}).`);
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
      if (event.cityStats) {
        appendLog(
          `${event.city}: processed ${event.cityStats.listingsProcessed} candidates, kept ${event.cityStats.listingsAccepted}, skipped ${event.cityStats.listingsSkipped}, failed ${event.cityStats.listingFailures}.`,
        );
      }
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
      if (!event.summary || typeof event.summary !== 'object') {
        break;
      }

      state.totalResults = event.summary.totalResults ?? state.totalResults;
      state.completedCities = event.summary.totalCities ?? state.completedCities;
      elements.statusPhase.textContent = 'Completed';
      elements.statusCopy.textContent = `Finished with ${event.summary.totalResults ?? state.totalResults} rows in ${formatRunDuration(event.summary.durationMs)}.`;
      break;
    default:
      break;
  }

  renderStatus();
}

function renderStatus() {
  const statusView = deriveStatusView({
    initialized: state.initialized,
    running: state.running,
    logsCount: state.logs.length,
  });

  if (statusView) {
    elements.statusCopy.textContent = statusView.copy;
    elements.statusPhase.textContent = statusView.phase;
  }

  elements.statusResults.textContent = `${state.totalResults}`;
  elements.statusCities.textContent = `${state.completedCities} / ${state.totalCities}`;
  renderActivityLog();

  elements.openOutputFolderButton.disabled = !state.outputDirectory;
}

function renderResults() {
  const resultsView = deriveResultsView({
    lastCompletedSummary: state.lastCompletedSummary,
    results: state.results,
  });
  elements.resultsEmpty.hidden = resultsView.resultsEmptyHidden;
  elements.resultsContent.hidden = resultsView.resultsContentHidden;

  if (!resultsView.hasCompletedRun) {
    elements.resultsTableBody.replaceChildren();
    elements.outputFiles.replaceChildren();
    elements.resultsSummary.textContent = resultsView.resultsSummary;
    return;
  }

  elements.resultsSummary.textContent = resultsView.resultsSummary;
  renderResultRows();
  renderOutputFiles();
}

function populateForm(formState) {
  elements.cities.value = formState.citiesText ?? '';
  elements.resultLimit.value = formState.resultLimit ?? 20;
  elements.browserChannel.value = formState.browserChannel ?? 'auto';
  elements.enrichWebsite.checked = formState.enrichWebsite !== false;
  elements.headful.checked = Boolean(formState.headful);
  elements.concurrency.value = formState.concurrency ?? 1;
  elements.detailConcurrency.value = formState.detailConcurrency ?? 1;
  elements.proxy.value = formState.proxy ?? '';

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
    browserChannel: elements.browserChannel.value,
    enrichWebsite: elements.enrichWebsite.checked,
    headful: elements.headful.checked,
    formats: selectedFormats,
    concurrency: Math.max(1, Number.parseInt(elements.concurrency.value, 10) || 1),
    detailConcurrency: Math.max(1, Number.parseInt(elements.detailConcurrency.value, 10) || 1),
    proxy: elements.proxy.value.trim() || undefined,
  };
}

function setFormDisabled(disabled) {
  state.formDisabled = disabled;

  for (const element of [
    elements.cities,
    elements.resultLimit,
    elements.browserChannel,
    elements.enrichWebsite,
    elements.headful,
    elements.concurrency,
    elements.detailConcurrency,
    elements.proxy,
    ...elements.formatCheckboxes,
  ]) {
    element.disabled = disabled;
  }

  renderRunButton();
  syncFormatSelection();
}

function appendLog(message, tone = 'info') {
  state.logs = [...state.logs, { message, tone }].slice(-120);
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

function countCities(citiesText) {
  return countUniqueCities(citiesText);
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
  const lastChecked = checkedCount === 1 ? elements.formatCheckboxes.find((checkbox) => checkbox.checked) : null;

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
      await runUiAction(() => getBridge().openOutputFile(filePath), `Failed to open ${fileName}`);
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
    await runUiAction(() => getBridge().openExternalUrl(safeUrl), `Failed to open ${safeUrl}`);
  });
  cell.append(button);
  return cell;
}

function renderRunButton() {
  const buttonView = deriveRunButtonView({
    initialized: state.initialized,
    formDisabled: state.formDisabled,
    bootstrapFailed: state.bootstrapFailed,
  });
  elements.runButton.disabled = buttonView.disabled;
  elements.runButton.textContent = buttonView.text;
}

function getBridge() {
  const bridge = window.oricalApp;
  if (!bridge || typeof bridge !== 'object') {
    throw new Error('Desktop bridge unavailable. Reload the app.');
  }

  for (const methodName of [
    'getDefaults',
    'startScrape',
    'openOutputFolder',
    'openOutputFile',
    'openExternalUrl',
    'onScrapeEvent',
  ]) {
    if (typeof bridge[methodName] !== 'function') {
      throw new Error(`Desktop bridge missing "${methodName}". Reload the app.`);
    }
  }

  return bridge;
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
