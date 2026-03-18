const state = {
  outputDirectory: '',
  running: false,
  totalResults: 0,
  completedCities: 0,
  totalCities: 0,
  logs: [],
  results: [],
  outputFiles: [],
};

const elements = {
  form: document.querySelector('#scrape-form'),
  cities: document.querySelector('#cities'),
  resultLimit: document.querySelector('#result-limit'),
  websitePageLimit: document.querySelector('#website-page-limit'),
  browserChannel: document.querySelector('#browser-channel'),
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

bootstrap().catch((error) => {
  appendLog(`Failed to load the app: ${error.message}`, 'error');
  elements.statusCopy.textContent = error.message;
  elements.statusPhase.textContent = 'Error';
});

async function bootstrap() {
  const initialData = await window.kekaApp.getDefaults();
  state.outputDirectory = initialData.outputDirectory;

  elements.outputDirectory.textContent = initialData.outputDirectory;
  elements.appVersion.textContent = initialData.appVersion;
  populateForm(initialData.formState);
  renderResults();
  renderStatus();

  elements.form.addEventListener('submit', handleSubmit);
  for (const checkbox of elements.formatCheckboxes) {
    checkbox.addEventListener('change', syncFormatSelection);
  }

  elements.openOutputFolderButton.addEventListener('click', async () => {
    if (state.outputDirectory) {
      await window.kekaApp.openOutputFolder();
    }
  });

  window.kekaApp.onScrapeEvent((event) => {
    handleScrapeEvent(event);
  });
}

async function handleSubmit(event) {
  event.preventDefault();

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
  state.totalResults = 0;
  state.completedCities = 0;
  state.totalCities = countCities(payload.citiesText);
  renderStatus();
  renderResults();
  setFormDisabled(true);
  appendLog(`Preparing a run for ${state.totalCities} ${state.totalCities === 1 ? 'city' : 'cities'}.`);

  try {
    const result = await window.kekaApp.startScrape(payload);
    state.results = result.results;
    state.outputFiles = result.outputFiles;
    state.outputDirectory = result.summary.outputDirectory;
    state.totalResults = result.summary.totalResults;
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
    case 'run-started':
      state.totalCities = event.cities.length;
      elements.statusPhase.textContent = 'Launching';
      elements.statusCopy.textContent = `Starting a local scrape. Files will be written to ${event.outputDirectory}.`;
      appendLog(`Starting local scrape. Output folder: ${event.outputDirectory}`);
      break;
    case 'browser-ready':
      elements.statusPhase.textContent = 'Scraping';
      appendLog(`Browser ready: ${event.selectedBrowserLabel} (requested: ${event.requestedBrowserChannel}).`);
      break;
    case 'city-started':
      elements.statusPhase.textContent = 'Scraping';
      elements.statusCopy.textContent = `Searching Google Maps for ${event.city}.`;
      appendLog(`City ${event.index}/${event.totalCities}: ${event.city}`);
      break;
    case 'city-completed':
      state.completedCities = event.index;
      state.totalResults = event.totalResultCount;
      elements.statusCopy.textContent = `${event.city} completed with ${event.cityResultCount} matches.`;
      appendLog(
        `${event.city} completed. ${event.cityResultCount} matches kept, ${event.totalResultCount} total so far.`,
      );
      break;
    case 'city-failed':
      state.completedCities = event.index;
      appendLog(`${event.city} failed: ${event.message}`, 'error');
      elements.statusCopy.textContent = `${event.city} failed, but the run is continuing.`;
      break;
    case 'enrichment-started':
      elements.statusPhase.textContent = 'Enriching';
      elements.statusCopy.textContent = `Checking ${event.totalListings} hostel websites for public contact details.`;
      appendLog(`Starting website enrichment for ${event.totalListings} listings.`);
      break;
    case 'enrichment-item-started':
      appendLog(`Enriching ${event.index}/${event.totalListings}: ${event.name ?? event.website ?? 'listing'}.`);
      break;
    case 'enrichment-item-completed':
      appendLog(`Website enrichment finished for ${event.name ?? event.website ?? 'listing'}.`);
      break;
    case 'enrichment-item-failed':
      appendLog(`Website enrichment failed for ${event.name ?? event.website ?? 'listing'}: ${event.message}`, 'error');
      break;
    case 'run-completed':
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
  if (!state.running && state.logs.length === 0) {
    elements.statusCopy.textContent = 'Ready to start.';
    elements.statusPhase.textContent = 'Idle';
  }

  elements.statusResults.textContent = `${state.totalResults}`;
  elements.statusCities.textContent = `${state.completedCities} / ${state.totalCities}`;
  elements.activityLog.innerHTML = state.logs
    .map((entry) => `<li class="${entry.tone}">${escapeHtml(entry.message)}</li>`)
    .join('');

  elements.openOutputFolderButton.disabled = !state.outputDirectory;
}

function renderResults() {
  const hasResults = state.results.length > 0;
  elements.resultsEmpty.hidden = hasResults;
  elements.resultsContent.hidden = !hasResults;

  if (!hasResults) {
    elements.resultsTableBody.innerHTML = '';
    elements.outputFiles.innerHTML = '';
    return;
  }

  elements.resultsSummary.textContent = `${state.results.length} ${state.results.length === 1 ? 'row' : 'rows'}`;
  elements.resultsTableBody.innerHTML = state.results
    .map((item) => {
      return `
        <tr>
          <td>${escapeHtml(item.name ?? '')}</td>
          <td>${escapeHtml(item.searchedCity ?? '')}</td>
          <td>${renderLinkCell(item.website)}</td>
          <td>${escapeHtml(item.generalEmail ?? '')}</td>
          <td>${escapeHtml(item.bestContactChannel ?? '')}</td>
          <td>${escapeHtml(item.bestContactValue ?? '')}</td>
        </tr>
      `;
    })
    .join('');

  elements.outputFiles.innerHTML = state.outputFiles
    .map((filePath) => {
      const fileName = filePath.split(/[\\/]/).pop();
      return `<button type="button" class="secondary output-file" data-path="${escapeHtml(filePath)}">${escapeHtml(fileName)}</button>`;
    })
    .join('');

  for (const button of elements.outputFiles.querySelectorAll('.output-file')) {
    button.addEventListener('click', async () => {
      await window.kekaApp.openOutputFile(button.dataset.path);
    });
  }

  for (const button of elements.resultsTableBody.querySelectorAll('.external-link')) {
    button.addEventListener('click', async () => {
      await window.kekaApp.openExternalUrl(button.dataset.url);
    });
  }
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

function readFormState() {
  const selectedFormats = elements.formatCheckboxes
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);

  if (selectedFormats.length === 0) {
    throw new Error('Select at least one output format before starting the scrape.');
  }

  return {
    citiesText: elements.cities.value,
    resultLimit: elements.resultLimit.value,
    websitePageLimit: elements.websitePageLimit.value,
    browserChannel: elements.browserChannel.value,
    enrichWebsite: elements.enrichWebsite.checked,
    headful: elements.headful.checked,
    formats: selectedFormats,
  };
}

function setFormDisabled(disabled) {
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

  elements.runButton.disabled = disabled;
  elements.runButton.textContent = disabled ? 'Running...' : 'Start scrape';
}

function appendLog(message, tone = 'info') {
  state.logs = [
    ...state.logs,
    { message, tone },
  ].slice(-120);
  renderStatus();
}

function buildCompletionMessage(summary) {
  const fileCount = summary.outputFiles.length;
  return `Run ${summary.outcome}. ${summary.totalResults} rows exported to ${fileCount} ${fileCount === 1 ? 'file' : 'files'}.`;
}

function countCities(citiesText) {
  return citiesText
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .length;
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

function renderLinkCell(url) {
  const safeUrl = sanitizeExternalUrl(url);
  if (!safeUrl) {
    return '';
  }

  const escapedUrl = escapeHtml(safeUrl);
  return `<button type="button" class="secondary external-link" data-url="${escapedUrl}">${escapedUrl}</button>`;
}

function escapeHtml(value) {
  return `${value ?? ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeExternalUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function syncFormatSelection() {
  const checkedCount = elements.formatCheckboxes.filter((checkbox) => checkbox.checked).length;
  const lastChecked = checkedCount === 1
    ? elements.formatCheckboxes.find((checkbox) => checkbox.checked)
    : null;

  for (const checkbox of elements.formatCheckboxes) {
    checkbox.disabled = !state.running && checkedCount === 1 && checkbox === lastChecked;
  }
}
