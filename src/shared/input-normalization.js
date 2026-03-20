const INVALID_URL_HOST_TOKENS = new Set(['-', '--', 'n/a', 'na', 'nil', 'none', 'null', 'undefined', 'unknown']);

const PUBLIC_HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const DEFAULT_DELIMITER_PATTERN = /[,\n;]+/;
const CITY_DELIMITER_PATTERN = /[\n;]+/;

export function normalizeInputToken(value) {
  return `${value ?? ''}`.replace(/\s+/g, ' ').trim();
}

export function splitDelimitedValues(rawValues = [], delimiterPattern = DEFAULT_DELIMITER_PATTERN) {
  return rawValues
    .flatMap((value) => `${value ?? ''}`.split(delimiterPattern))
    .map((value) => normalizeInputToken(value))
    .filter(Boolean);
}

export function splitCityInput(rawValues = []) {
  return splitDelimitedValues(Array.isArray(rawValues) ? rawValues : [rawValues], CITY_DELIMITER_PATTERN);
}

export function countUniqueCities(rawValues = []) {
  return new Set(splitCityInput(rawValues)).size;
}

export function normalizePotentialUrl(value) {
  const trimmedValue = normalizeInputToken(value);
  if (!trimmedValue) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  if (!isLikelyPublicHostname(trimmedValue)) {
    return '';
  }

  return `https://${trimmedValue}`;
}

export function normalizePublicUrl(value) {
  const normalizedValue = normalizePotentialUrl(value);
  if (!normalizedValue) {
    return null;
  }

  try {
    const parsed = new URL(normalizedValue);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      hasUrlCredentials(parsed) ||
      !isLikelyPublicHostname(parsed.hostname)
    ) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function isLikelyPublicHostname(value) {
  const normalizedValue = normalizeInputToken(value).toLowerCase();
  if (!normalizedValue) {
    return false;
  }

  const hostname = normalizedValue.split(/[/?#]/, 1)[0].replace(/:\d{1,5}$/, '');
  if (!hostname || hostname.includes('@') || INVALID_URL_HOST_TOKENS.has(hostname)) {
    return false;
  }

  return PUBLIC_HOSTNAME_PATTERN.test(hostname);
}

export function hasUrlCredentials(value) {
  const parsed = value instanceof URL ? value : new URL(value);
  return parsed.username !== '' || parsed.password !== '';
}
