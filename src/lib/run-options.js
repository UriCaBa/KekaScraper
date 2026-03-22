import { defaultConfig } from '../config.js';
import { normalizeWhitespace } from './utils.js';
import { splitCityInput, splitDelimitedValues } from '../shared/input-normalization.js';

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
    resultLimit: normalizeInteger(input.resultLimit, defaultConfig.resultLimit, 'resultLimit', { max: 400 }),
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
    actionTimeoutMs: normalizeInteger(input.actionTimeoutMs, defaultConfig.actionTimeoutMs, 'actionTimeoutMs', {
      min: 1,
    }),
    websiteFetchTimeoutMs: normalizeInteger(
      input.websiteFetchTimeoutMs,
      defaultConfig.websiteFetchTimeoutMs,
      'websiteFetchTimeoutMs',
      { min: 1 },
    ),
    headless: normalizeBoolean(input.headless, defaultConfig.headless),
    enrichWebsite: normalizeBoolean(input.enrichWebsite, defaultConfig.enrichWebsite),
    coordinates: normalizeCoordinates(input),
    proxy: normalizeProxy(input),
    resume: normalizeBoolean(input.resume, false),
    concurrency: normalizeInteger(input.concurrency, 1, 'concurrency', { min: 1 }),
    detailConcurrency: normalizeInteger(input.detailConcurrency, 1, 'detailConcurrency', { min: 1, max: 6 }),
  };
}

export function normalizeBrowserChannel(value, flagName = 'browserChannel') {
  const normalizedValue = `${value}`.trim().toLowerCase();
  if (!ALLOWED_BROWSER_CHANNELS.includes(normalizedValue)) {
    throw new Error(`Expected one of ${ALLOWED_BROWSER_CHANNELS.join(', ')} for ${flagName}, got "${value}"`);
  }

  return normalizedValue;
}

export function normalizeInteger(value, defaultValue, flagName, options = {}) {
  const { min = 1, max } = options;

  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min) {
    throw new Error(`Expected an integer >= ${min} for ${flagName}, got "${value}"`);
  }

  if (max != null && parsed > max) {
    throw new Error(`Expected an integer <= ${max} for ${flagName}, got "${value}"`);
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

  const items = splitDelimitedValues(Array.isArray(value) ? value : [`${value}`]);
  const normalized = [
    ...new Set(
      items.map((item) => `${item}`.trim().toLowerCase()).filter((item) => ALLOWED_OUTPUT_FORMATS.includes(item)),
    ),
  ];

  return normalized.length ? normalized : [...defaultConfig.formats];
}

function normalizeCoordinates(input) {
  const lat = input.lat != null ? parseFloat(input.lat) : null;
  const lng = input.lng != null ? parseFloat(input.lng) : null;

  if (lat == null && lng == null) {
    return undefined;
  }

  if (lat == null || lng == null) {
    throw new Error('Both --lat and --lng must be provided together.');
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`Latitude and longitude must be valid numbers, got lat=${input.lat}, lng=${input.lng}`);
  }

  if (lat < -90 || lat > 90) {
    throw new Error(`Latitude must be between -90 and 90, got ${lat}`);
  }

  if (lng < -180 || lng > 180) {
    throw new Error(`Longitude must be between -180 and 180, got ${lng}`);
  }

  const zoom = input.zoom != null ? Number.parseInt(input.zoom, 10) : 15;
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 21) {
    throw new Error(`Zoom must be an integer between 1 and 21, got ${input.zoom}`);
  }
  return { lat, lng, zoom };
}

function normalizeProxy(input) {
  const raw = input.proxy;
  if (!raw || (typeof raw === 'string' && !raw.trim())) {
    return undefined;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'socks5:') {
      throw new Error('Proxy protocol must be http, https, or socks5');
    }

    return {
      server: `${url.protocol}//${url.host}`,
      username: url.username || undefined,
      password: url.password || undefined,
    };
  } catch (error) {
    if (error.message.includes('Proxy protocol')) throw error;
    throw new Error(`Invalid proxy URL: ${sanitizeProxyForLogging(raw)}`, { cause: error });
  }
}

function sanitizeProxyForLogging(raw) {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    // Return a redacted form that strips potential credentials (before @)
    // but preserves the host portion for actionable error messages.
    const value = String(raw).trim();
    if (!value) return '<empty>';
    const atIndex = value.lastIndexOf('@');
    if (atIndex === -1) return value;
    return `<redacted>@${value.slice(atIndex + 1)}`;
  }
}

function normalizeCities(value) {
  if (value === undefined || value === null) {
    return [];
  }

  const items = Array.isArray(value)
    ? value.map((item) => normalizeWhitespace(String(item))).filter(Boolean)
    : splitCityInput([`${value}`])
        .map((item) => normalizeWhitespace(String(item)))
        .filter(Boolean);

  return [...new Set(items)];
}
