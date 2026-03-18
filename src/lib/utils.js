import fs from 'node:fs/promises';

const INVALID_URL_HOST_TOKENS = new Set(['-', '--', 'n/a', 'na', 'nil', 'none', 'null', 'undefined', 'unknown']);
const PUBLIC_HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry(task, options = {}) {
  const {
    retries = 2,
    delayMs = 1000,
    label = 'operation',
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;

      if (attempt > retries) {
        break;
      }

      console.warn(`[retry] ${label} failed on attempt ${attempt}. Retrying...`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function normalizeWhitespace(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return repairMojibake(normalized);
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return normalizeWhitespace(value);
    }

    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }

  return null;
}

export function stripFieldPrefix(value) {
  if (!value) {
    return null;
  }

  return normalizeWhitespace(value)
    .replace(/^[^\p{L}\p{N}+]+/u, '')
    .replace(/^(address|direccion|dirección|adresse|indirizzo|ubicacion|ubicación)\s*:?\s*/i, '')
    .replace(/^(website|sitio web|web)\s*:?\s*/i, '')
    .replace(/^(phone|telefono|teléfono|telefon|tlf)\s*:?\s*/i, '');
}

export function parseNumber(value) {
  if (!value) {
    return null;
  }

  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) {
    return null;
  }

  const parsed = Number.parseInt(digits, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseRating(value) {
  if (!value) {
    return null;
  }

  const match = String(value)
    .replace(',', '.')
    .match(/(\d+(?:\.\d+)?)/);

  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[1]);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseRatingAndReviews(rawValue) {
  if (!rawValue) {
    return { rating: null, reviewCount: null };
  }

  const normalized = normalizeWhitespace(String(rawValue));
  const rating = parseRating(normalized);

  let reviewCount = null;
  const reviewMatch =
    normalized.match(/(\d[\d.,\s]*)\s+reviews?/i)
    ?? normalized.match(/(\d[\d.,\s]*)\s+rese(?:ñas|nas)?/i)
    ?? normalized.match(/\((\d[\d.,\s]*)\)/);

  if (reviewMatch) {
    reviewCount = parseNumber(reviewMatch[1]);
  }

  return { rating, reviewCount };
}

export function toCsv(rows) {
  if (!rows.length) {
    return '';
  }

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ];

  return lines.join('\n');
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue =
    typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }

  return `"${stringValue.replace(/"/g, '""')}"`;
}

export function timestampLabel(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

export function splitCities(rawValues) {
  return rawValues
    .flatMap((value) => String(value).split(/[,\n;]+/))
    .map((city) => normalizeWhitespace(city))
    .filter(Boolean);
}

export function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const normalizedValue = normalizePotentialUrl(value);
    if (!normalizedValue) {
      return null;
    }

    const parsed = new URL(normalizedValue);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || !isLikelyPublicHostname(parsed.hostname)
    ) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => normalizeWhitespace(String(value))).filter(Boolean))];
}

function normalizePotentialUrl(value) {
  const trimmedValue = normalizeWhitespace(String(value));
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

function isLikelyPublicHostname(value) {
  const normalizedValue = normalizeWhitespace(String(value)).toLowerCase();
  if (!normalizedValue) {
    return false;
  }

  const hostname = normalizedValue
    .split(/[/?#]/, 1)[0]
    .replace(/:\d{1,5}$/, '');
  if (!hostname || hostname.includes('@') || INVALID_URL_HOST_TOKENS.has(hostname)) {
    return false;
  }

  return PUBLIC_HOSTNAME_PATTERN.test(hostname);
}

function repairMojibake(value) {
  if (!/[ÃÂâ€™â€œâ€]/.test(value)) {
    return value;
  }

  try {
    return Buffer.from(value, 'latin1').toString('utf8');
  } catch {
    return value;
  }
}
