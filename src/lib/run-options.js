import { defaultConfig } from '../config.js';
import { normalizeWhitespace } from './utils.js';
import { splitCityInput } from '../shared/input-normalization.js';

export const ALLOWED_BROWSER_CHANNELS = ['auto', 'msedge', 'chrome', 'chromium'];
export const ALLOWED_OUTPUT_FORMATS = ['json', 'csv'];

export function normalizeRunOptions(input = {}, { requireCities = true } = {}) {
  const cities = normalizeCities(input.cities);
  if (requireCities && cities.length === 0) {
    throw new Error('At least one city is required.');
  }

  const formats = normalizeFormats(input.formats);

  return {
    ...defaultConfig,
    ...input,
    cities,
    formats,
    browserChannel: normalizeBrowserChannel(input.browserChannel ?? defaultConfig.browserChannel),
    resultLimit: normalizeInteger(input.resultLimit, defaultConfig.resultLimit, 'resultLimit'),
    slowMo: normalizeInteger(input.slowMo, defaultConfig.slowMo, 'slowMo', { min: 0 }),
    maxScrollRounds: normalizeInteger(input.maxScrollRounds, defaultConfig.maxScrollRounds, 'maxScrollRounds'),
    websitePageLimit: normalizeInteger(input.websitePageLimit, defaultConfig.websitePageLimit, 'websitePageLimit'),
    retryCount: normalizeInteger(input.retryCount, defaultConfig.retryCount, 'retryCount', { min: 0 }),
    retryDelayMs: normalizeInteger(input.retryDelayMs, defaultConfig.retryDelayMs, 'retryDelayMs', { min: 0 }),
    detailPauseMs: normalizeInteger(input.detailPauseMs, defaultConfig.detailPauseMs, 'detailPauseMs', { min: 0 }),
    navigationTimeoutMs: normalizeInteger(
      input.navigationTimeoutMs,
      defaultConfig.navigationTimeoutMs,
      'navigationTimeoutMs',
      { min: 1 },
    ),
    actionTimeoutMs: normalizeInteger(
      input.actionTimeoutMs,
      defaultConfig.actionTimeoutMs,
      'actionTimeoutMs',
      { min: 1 },
    ),
    websiteFetchTimeoutMs: normalizeInteger(
      input.websiteFetchTimeoutMs,
      defaultConfig.websiteFetchTimeoutMs,
      'websiteFetchTimeoutMs',
      { min: 1 },
    ),
    headless: normalizeBoolean(input.headless, defaultConfig.headless),
    enrichWebsite: normalizeBoolean(input.enrichWebsite, defaultConfig.enrichWebsite),
  };
}

export function normalizeBrowserChannel(value, flagName = 'browserChannel') {
  const normalizedValue = `${value}`.trim().toLowerCase();
  if (!ALLOWED_BROWSER_CHANNELS.includes(normalizedValue)) {
    throw new Error(
      `Expected one of ${ALLOWED_BROWSER_CHANNELS.join(', ')} for ${flagName}, got "${value}"`,
    );
  }

  return normalizedValue;
}

export function normalizeInteger(value, defaultValue, flagName, options = {}) {
  const { min = 1 } = options;

  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min) {
    throw new Error(`Expected an integer >= ${min} for ${flagName}, got "${value}"`);
  }

  return parsed;
}

export function normalizeBoolean(value, defaultValue) {
  return typeof value === 'boolean' ? value : defaultValue;
}

export function normalizeFormats(value) {
  if (value === undefined || value === null) {
    return [...defaultConfig.formats];
  }

  const items = splitCityInput(Array.isArray(value) ? value : [`${value}`]);
  const normalized = [...new Set(
    items
      .map((item) => `${item}`.trim().toLowerCase())
      .filter((item) => ALLOWED_OUTPUT_FORMATS.includes(item)),
  )];

  return normalized.length ? normalized : [...defaultConfig.formats];
}

function normalizeCities(value) {
  if (value === undefined || value === null) {
    return [];
  }

  const items = Array.isArray(value)
    ? value.map((item) => normalizeWhitespace(String(item))).filter(Boolean)
    : splitCityInput([`${value}`]).map((item) => normalizeWhitespace(String(item))).filter(Boolean);

  return [...new Set(items)];
}
