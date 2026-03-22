import { RUN_EVENT_TYPES } from '../lib/run-events.js';
import { computeStats, filterResults } from '../shared/dashboard-utils.js';
import { countUniqueCities, normalizePublicUrl } from '../shared/input-normalization.js';
import { formatListingSkipReason } from '../shared/event-formatting.js';
import { isEmptyListing } from '../shared/listing-utils.js';
import {
  buildCompletionMessage as formatCompletionMessage,
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
  activeTab: 'scrape',
};

const RESULTS_PREVIEW_LIMIT = 200;
const DASH_ROW_LIMIT = 500;

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
  concurrency: document.querySelector('#concurrency'),
  detailConcurrency: document.querySelector('#detail-concurrency'),
  proxy: document.querySelector('#proxy'),
  resultLimitHelp: document.querySelector('#result-limit-help'),
  detailConcurrencyHelp: document.querySelector('#detail-concurrency-help'),
  pickOutputFolderButton: document.querySelector('#pick-output-folder'),
  openHelpButton: document.querySelector('#open-help'),
  closeHelpButton: document.querySelector('#close-help'),
  helpDialog: document.querySelector('#help-dialog'),
  tabButtons: [...document.querySelectorAll('.tab-button')],
  tabScrape: document.querySelector('#tab-scrape'),
  tabLastScrape: document.querySelector('#tab-last-scrape'),
  tabDashboard: document.querySelector('#tab-dashboard'),
  dashLoadJson: document.querySelector('#dash-load-json'),
};

function createViewElements(prefix) {
  return {
    fileLabel: document.querySelector(`#${prefix}-file-label`),
    search: document.querySelector(`#${prefix}-search`),
    count: document.querySelector(`#${prefix}-count`),
    empty: document.querySelector(`#${prefix}-empty`),
    content: document.querySelector(`#${prefix}-content`),
    tableBody: document.querySelector(`#${prefix}-table-body`),
    hint: document.querySelector(`#${prefix}-hint`),
    detailContainer: document.querySelector(`#${prefix}-detail-container`),
    detailName: document.querySelector(`#${prefix}-detail-name`),
    detailSubtitle: document.querySelector(`#${prefix}-detail-subtitle`),
    detailClose: document.querySelector(`#${prefix}-detail-close`),
    detailBasic: document.querySelector(`#${prefix}-detail-basic`),
    detailContact: document.querySelector(`#${prefix}-detail-contact`),
    detailDm: document.querySelector(`#${prefix}-detail-dm`),
    detailSocial: document.querySelector(`#${prefix}-detail-social`),
    detailEnrichment: document.querySelector(`#${prefix}-detail-enrichment`),
    statTotal: document.querySelector(`#${prefix}-stat-total`),
    statWithEmail: document.querySelector(`#${prefix}-stat-with-email`),
    statWithPhone: document.querySelector(`#${prefix}-stat-with-phone`),
    statWithDm: document.querySelector(`#${prefix}-stat-with-dm`),
    statEnriched: document.querySelector(`#${prefix}-stat-enriched`),
    statWithSocial: document.querySelector(`#${prefix}-stat-with-social`),
    footerCount: document.querySelector(`#${prefix}-footer-count`),
    statBarEmail: document.querySelector(`#${prefix}-stat-bar-email`),
    statBarPhone: document.querySelector(`#${prefix}-stat-bar-phone`),
    statBarDm: document.querySelector(`#${prefix}-stat-bar-dm`),
    statBarEnriched: document.querySelector(`#${prefix}-stat-bar-enriched`),
    statBarSocial: document.querySelector(`#${prefix}-stat-bar-social`),
  };
}

function createView(prefix) {
  return {
    results: [],
    selectedIndex: -1,
    searchQuery: '',
    statFilter: null,
    fileName: '',
    loaded: false,
    elements: createViewElements(prefix),
  };
}

const lastScrapeView = createView('ls');
const dashboardView = createView('dash');

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

  elements.resultLimit.addEventListener('input', updateLimitWarnings);
  elements.detailConcurrency.addEventListener('input', updateLimitWarnings);
  updateLimitWarnings();

  elements.openOutputFolderButton.addEventListener('click', async () => {
    if (state.outputDirectory) {
      await runUiAction(() => bridge.openOutputFolder(), 'Failed to open the output folder');
    }
  });

  elements.pickOutputFolderButton.addEventListener('click', () => {
    return runUiAction(async () => {
      const pickedPath = await bridge.pickOutputFolder();
      if (pickedPath) {
        state.outputDirectory = pickedPath;
        elements.outputDirectory.textContent = pickedPath;
      }
    }, 'Failed to pick an output folder');
  });

  elements.openHelpButton.addEventListener('click', () => {
    elements.helpDialog.showModal();
  });

  elements.closeHelpButton.addEventListener('click', () => {
    elements.helpDialog.close();
  });

  elements.helpDialog.addEventListener('click', (event) => {
    if (event.target === elements.helpDialog) {
      elements.helpDialog.close();
    }
  });

  // Tab navigation
  for (const button of elements.tabButtons) {
    button.addEventListener('click', () => {
      switchTab(button.dataset.tab);
    });
  }

  // Dashboard: load JSON (adds to dashboard view)
  elements.dashLoadJson.addEventListener('click', async () => {
    await runUiAction(handleLoadResults, 'Failed to load results file');
  });

  // Wire up search, stat chips, detail close, and Escape for both views
  for (const view of [lastScrapeView, dashboardView]) {
    if (view.elements.search) {
      view.elements.search.addEventListener('input', () => {
        view.searchQuery = view.elements.search.value.trim().toLowerCase();
        renderViewTable(view);
      });
    }

    if (view.elements.detailClose) {
      view.elements.detailClose.addEventListener('click', () => {
        closeViewDetail(view);
      });
    }
  }

  for (const chip of document.querySelectorAll('.stat-chip[data-filter]')) {
    chip.addEventListener('click', () => {
      const viewName = chip.dataset.view;
      const view = viewName === 'lastScrape' ? lastScrapeView : dashboardView;
      const filter = chip.dataset.filter;
      view.statFilter = view.statFilter === filter ? null : filter;
      updateViewStatChips(view, viewName);
      renderViewTable(view);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const activeView = state.activeTab === 'last-scrape' ? lastScrapeView : dashboardView;
      if (activeView.elements.detailContainer && !activeView.elements.detailContainer.hidden) {
        closeViewDetail(activeView);
      }
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

// ── Tab switching ──

async function switchTab(tabName) {
  state.activeTab = tabName;

  for (const button of elements.tabButtons) {
    const isActive = button.dataset.tab === tabName;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  }

  elements.tabScrape.hidden = tabName !== 'scrape';
  elements.tabLastScrape.hidden = tabName !== 'last-scrape';
  elements.tabDashboard.hidden = tabName !== 'dashboard';

  if (tabName === 'dashboard' && !dashboardView.loaded) {
    try {
      const data = await getBridge().loadAllResults();
      dashboardView.results = data.results.filter((item) => !isEmptyListing(item)).slice(0, DASH_ROW_LIMIT);
      dashboardView.fileName = data.fileCount > 0 ? `${data.fileCount} files from output folder` : '';
      dashboardView.loaded = true;
      renderView(dashboardView);
    } catch {
      // Auto-load failure is non-fatal — user can still use Load JSON.
    }
  }
}

// ── Scrape logic (unchanged) ──

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

    // Push results to Last Scrape view and auto-switch
    lastScrapeView.results = state.results.filter((item) => !isEmptyListing(item));
    lastScrapeView.selectedIndex = -1;
    lastScrapeView.fileName = '';
    lastScrapeView.statFilter = null;
    lastScrapeView.searchQuery = '';
    if (lastScrapeView.elements.search) lastScrapeView.elements.search.value = '';
    updateViewStatChips(lastScrapeView, 'lastScrape');
    renderView(lastScrapeView);
    // Invalidate dashboard so it reloads with new data on next visit
    dashboardView.loaded = false;
    switchTab('last-scrape');
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
    case RUN_EVENT_TYPES.BATCH_STARTED:
      appendLog(`Starting batch ${event.batch} of ${event.totalBatches} (${event.batchLimit} listings).`);
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
  // Results are now shown in the Dashboard tab — this is a no-op for backward compat.
}

const SAFE_RESULT_LIMIT = 100;
const SAFE_DETAIL_CONCURRENCY = 3;

function updateLimitWarnings() {
  const limit = Number.parseInt(elements.resultLimit.value, 10) || 0;
  const detailConc = Number.parseInt(elements.detailConcurrency.value, 10) || 0;

  if (limit > SAFE_RESULT_LIMIT) {
    elements.resultLimitHelp.textContent = `Warning: above ${SAFE_RESULT_LIMIT} results is much slower and very likely to trigger rate limits without a proxy. Use at your own risk.`;
    elements.resultLimitHelp.classList.add('warning');
  } else {
    elements.resultLimitHelp.textContent =
      'Recommended 20-50. Above 50 is slower and may trigger rate limits without a proxy.';
    elements.resultLimitHelp.classList.remove('warning');
  }

  if (detailConc > SAFE_DETAIL_CONCURRENCY) {
    elements.detailConcurrencyHelp.textContent = `Warning: above ${SAFE_DETAIL_CONCURRENCY} parallel listings significantly increases rate-limit and blocking risk. Use at your own risk.`;
    elements.detailConcurrencyHelp.classList.add('warning');
  } else {
    elements.detailConcurrencyHelp.textContent = 'Recommended 1-2. 3 is faster but increases rate-limit risk.';
    elements.detailConcurrencyHelp.classList.remove('warning');
  }
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

  elements.dashLoadJson.disabled = disabled;
  elements.pickOutputFolderButton.disabled = disabled;
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
    'loadResultsFile',
    'loadAllResults',
    'pickOutputFolder',
  ]) {
    if (typeof bridge[methodName] !== 'function') {
      throw new Error(`Desktop bridge missing "${methodName}". Reload the app.`);
    }
  }

  return bridge;
}

// ── Dashboard / View System ──

function closeViewDetail(view) {
  view.selectedIndex = -1;
  if (view.elements.detailContainer) view.elements.detailContainer.hidden = true;
  if (view.elements.content) view.elements.content.hidden = false;
}

async function handleLoadResults() {
  const data = await getBridge().loadResultsFile();
  if (!data) return;

  const filtered = data.results.filter((item) => !isEmptyListing(item));

  const seen = new Set();
  const deduped = [];
  for (const item of filtered) {
    const key = item.googleMapsUrl || '';
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    deduped.push(item);
  }

  dashboardView.results = deduped.slice(0, DASH_ROW_LIMIT);
  if (deduped.length > DASH_ROW_LIMIT) {
    appendLog(`Dashboard shows first ${DASH_ROW_LIMIT} of ${deduped.length} results.`);
    renderStatus();
  }
  dashboardView.selectedIndex = -1;
  dashboardView.fileName = data.fileName;
  dashboardView.searchQuery = '';
  dashboardView.statFilter = null;
  dashboardView.loaded = true;
  if (dashboardView.elements.search) dashboardView.elements.search.value = '';
  if (dashboardView.elements.detailContainer) dashboardView.elements.detailContainer.hidden = true;
  updateViewStatChips(dashboardView, 'dashboard');
  renderView(dashboardView);
}

function getFilteredResults(view) {
  return filterResults(view.results, view.statFilter, view.searchQuery);
}

function updateViewStatChips(view, viewName) {
  for (const chip of document.querySelectorAll(`.stat-chip[data-view="${viewName}"]`)) {
    const isActive = chip.dataset.filter === view.statFilter;
    chip.classList.toggle('stat-chip-active', isActive);
    chip.setAttribute('aria-pressed', String(isActive));
  }
}

function renderView(view) {
  const el = view.elements;
  const allResults = view.results;
  const hasData = allResults.length > 0;

  if (el.empty) el.empty.hidden = hasData;
  if (el.content) el.content.hidden = !hasData;
  if (el.fileLabel) el.fileLabel.textContent = view.fileName || '';

  const stats = computeStats(allResults);
  const total = stats.total || 1;
  if (el.statTotal) el.statTotal.textContent = `${stats.total}`;
  if (el.statWithEmail) el.statWithEmail.textContent = `${stats.withEmail}`;
  if (el.statWithPhone) el.statWithPhone.textContent = `${stats.withPhone}`;
  if (el.statWithDm) el.statWithDm.textContent = `${stats.withDm}`;
  if (el.statEnriched) el.statEnriched.textContent = `${stats.enriched}`;
  if (el.statWithSocial) el.statWithSocial.textContent = `${stats.withSocial}`;

  if (el.statBarEmail) el.statBarEmail.style.width = `${Math.round((stats.withEmail / total) * 100)}%`;
  if (el.statBarPhone) el.statBarPhone.style.width = `${Math.round((stats.withPhone / total) * 100)}%`;
  if (el.statBarDm) el.statBarDm.style.width = `${Math.round((stats.withDm / total) * 100)}%`;
  if (el.statBarEnriched) el.statBarEnriched.style.width = `${Math.round((stats.enriched / total) * 100)}%`;
  if (el.statBarSocial) el.statBarSocial.style.width = `${Math.round((stats.withSocial / total) * 100)}%`;

  renderViewTable(view);
}

function renderViewTable(view) {
  const el = view.elements;
  const filtered = getFilteredResults(view);

  if (el.count) el.count.textContent = `${filtered.length} hostel${filtered.length === 1 ? '' : 's'}`;
  if (el.footerCount) el.footerCount.textContent = `Showing ${filtered.length} of ${view.results.length} results`;

  const indexByItem = new Map();
  view.results.forEach((item, index) => indexByItem.set(item, index));

  const fragment = document.createDocumentFragment();

  for (const item of filtered) {
    const realIndex = indexByItem.get(item) ?? -1;
    const row = document.createElement('tr');

    if (realIndex === view.selectedIndex) row.classList.add('selected');

    row.addEventListener('click', () => {
      view.selectedIndex = realIndex;
      renderViewTable(view);
      renderViewDetail(view, item);
    });

    row.append(
      createDashCell(item.name, true),
      createDashCell(item.searchedCity),
      createCompletenessCell(item),
      createDashCell(item.generalEmail),
      createDashCell(item.bestContactChannel),
      createDashCell(item.phone || item.websitePhone, false, true),
      createStatusDotCell(item.websiteScanStatus),
    );
    fragment.append(row);
  }

  if (el.tableBody) el.tableBody.replaceChildren(fragment);
}

function createDashCell(value, isBold, isPhone) {
  const cell = document.createElement('td');
  const text = `${value ?? ''}`.trim();
  if (!text) {
    cell.textContent = '\u2013';
    cell.classList.add('cell-empty');
  } else {
    cell.textContent = text;
    if (isBold) {
      cell.style.fontWeight = '600';
      cell.style.color = 'var(--ink)';
    }
    if (isPhone) {
      cell.classList.add('cell-phone');
    }
  }
  return cell;
}

function createCompletenessCell(item) {
  const cell = document.createElement('td');
  const bar = document.createElement('div');
  bar.className = 'completeness-bar';

  const segments = [
    Boolean(item.generalEmail),
    Boolean(item.phone || item.websitePhone),
    Boolean(item.instagramUrl || item.facebookUrl || item.linkedinUrl || item.twitterUrl),
    Boolean(item.decisionMakerName),
    Boolean(item.websiteScanStatus === 'ok'),
  ];

  for (const filled of segments) {
    const seg = document.createElement('div');
    seg.className = `completeness-seg${filled ? ' filled' : ''}`;
    bar.append(seg);
  }

  cell.append(bar);
  cell.title = `Email: ${segments[0] ? 'Yes' : 'No'}, Phone: ${segments[1] ? 'Yes' : 'No'}, Social: ${segments[2] ? 'Yes' : 'No'}, DM: ${segments[3] ? 'Yes' : 'No'}, Enriched: ${segments[4] ? 'Yes' : 'No'}`;
  return cell;
}

function createStatusDotCell(status) {
  const cell = document.createElement('td');
  const container = document.createElement('div');
  container.className = 'status-dot-cell';

  const dot = document.createElement('span');
  const statusText = `${status ?? 'unknown'}`;
  const cssClass = statusText.replace(/[^a-z-]/gi, '') || 'unknown';
  dot.className = `status-dot ${cssClass}`;

  const text = document.createElement('span');
  text.className = 'status-text';
  text.textContent = statusText;

  container.append(dot, text);
  cell.append(container);
  return cell;
}

function renderViewDetail(view, item) {
  const el = view.elements;
  if (el.content) el.content.hidden = true;
  if (el.detailContainer) el.detailContainer.hidden = false;

  if (el.detailName) el.detailName.textContent = item.name ?? 'Unknown';
  const parts = [item.searchedCity, item.category].filter(Boolean);
  if (el.detailSubtitle) el.detailSubtitle.textContent = parts.join(' \u00B7 ');

  renderDetailGrid(el.detailContact, [
    ['Best channel', item.bestContactChannel, 'highlight'],
    ['Best value', item.bestContactValue, 'highlight'],
    ['General email', item.generalEmail],
    ['Hostel email', item.hostelEmail],
    ['Phone (Maps)', item.phone],
    ['Phone (website)', item.websitePhone],
    ['Contact page', item.contactPage, 'link'],
    ['Contact form', item.contactFormUrl, 'link'],
    ['Strategy', item.contactStrategy],
  ]);

  // Decision Maker
  renderDetailGrid(el.detailDm, [
    ['Name', item.decisionMakerName],
    ['Role', item.decisionMakerRole],
    ['Email', item.decisionMakerEmail],
    ['Phone', item.decisionMakerPhone],
    ['Source', item.publicDecisionMakerSourceUrl, 'link'],
  ]);

  // Social Media
  const socialContainer = el.detailSocial;
  if (socialContainer) {
    socialContainer.replaceChildren();
    const socialEntries = [
      ['Instagram', item.instagramUrl],
      ['Facebook', item.facebookUrl],
      ['LinkedIn', item.linkedinUrl],
      ['Twitter/X', item.twitterUrl],
      ['TikTok', item.tiktokUrl],
      ['YouTube', item.youtubeUrl],
    ];

    const linksDiv = document.createElement('div');
    linksDiv.className = 'social-links';
    let hasSocial = false;

    for (const [label, url] of socialEntries) {
      if (!url) {
        continue;
      }
      hasSocial = true;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary social-link';
      button.textContent = label;
      button.addEventListener('click', async () => {
        await runUiAction(() => getBridge().openExternalUrl(url), `Failed to open ${label}`);
      });
      linksDiv.append(button);
    }

    if (!hasSocial) {
      const empty = document.createElement('div');
      empty.className = 'detail-value empty';
      empty.textContent = '\u2013';
      socialContainer.append(empty);
    } else {
      socialContainer.append(linksDiv);
    }
  }

  // Basic Info
  renderDetailGrid(el.detailBasic, [
    ['Rating', item.rating != null ? `${item.rating} / 5` : null],
    ['Reviews', item.reviewCount],
    ['Category', item.category],
    ['Address', item.address],
    ['Google Maps', item.googleMapsUrl, 'link'],
    ['Website', item.website, 'link'],
  ]);

  // Enrichment Details
  const enrichmentFields = [
    ['Scan status', item.websiteScanStatus],
    ['Pages scanned', item.websitePagesScanned],
    ['Rooms', item.roomCount],
    ['Beds', item.bedCount],
    ['Last seen', item.lastSeenAt],
    ['Emails found', item.emailCandidateCount ?? (item.allFoundEmails ?? []).length],
  ];

  if (Array.isArray(item.allFoundEmails) && item.allFoundEmails.length > 0) {
    enrichmentFields.push(['All emails', item.allFoundEmails.join(', ')]);
  }

  if (Array.isArray(item.emailCandidates) && item.emailCandidates.length > 0) {
    for (const candidate of item.emailCandidates) {
      const label = candidate.recommended ? `${candidate.email} *` : candidate.email;
      const detail = `Score ${candidate.score}, ${candidate.confidence}`;
      enrichmentFields.push([label, detail]);
    }
  }

  renderDetailGrid(el.detailEnrichment, enrichmentFields);
}

function renderDetailGrid(container, fields) {
  container.replaceChildren();

  for (const [label, value, style] of fields) {
    const field = document.createElement('div');
    field.className = 'detail-field';

    const labelEl = document.createElement('span');
    labelEl.className = 'detail-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    const displayValue = value != null && value !== '' ? `${value}` : null;

    if (!displayValue) {
      valueEl.className = 'detail-value empty';
      valueEl.textContent = '\u2013';
    } else if (style === 'link') {
      valueEl.className = 'detail-value link';
      valueEl.textContent = displayValue;
      valueEl.addEventListener('click', async () => {
        const safeUrl = sanitizeExternalUrl(displayValue);
        if (safeUrl) {
          await runUiAction(() => getBridge().openExternalUrl(safeUrl), `Failed to open link`);
        }
      });
    } else if (style === 'highlight') {
      valueEl.className = 'detail-value highlight';
      valueEl.textContent = displayValue;
    } else {
      valueEl.className = 'detail-value';
      valueEl.textContent = displayValue;
    }

    field.append(labelEl, valueEl);
    container.append(field);
  }
}
