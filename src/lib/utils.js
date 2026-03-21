import fs from 'node:fs/promises';
import { emitRunEvent, RUN_EVENT_TYPES } from './run-events.js';
import { normalizePublicUrl, splitCityInput } from '../shared/input-normalization.js';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry(task, options = {}) {
  const { retries = 2, delayMs = 1000, label = 'operation', onEvent, eventContext = {} } = options;

  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;

      if (attempt > retries) {
        break;
      }

      emitRunEvent(onEvent ?? (() => {}), RUN_EVENT_TYPES.RETRYING, {
        ...eventContext,
        label,
        attempt,
        retries,
        message: error.message,
      });
      await sleep(delayMs * Math.min(2 ** (attempt - 1), 8));
    }
  }

  throw lastError;
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  try {
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
      try {
        await fs.rm(filePath, { force: true });
        await fs.rename(tmpPath, filePath);
        return;
      } catch {
        await fs.copyFile(tmpPath, filePath);
        await fs.rm(tmpPath, { force: true });
        return;
      }
    }
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const targetConcurrency = Math.max(1, Number.parseInt(concurrency, 10) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(targetConcurrency, items.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
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

  const str = String(value).trim();

  // Reject values that look like decimals (e.g. "4,5" or "4.5").
  // parseNumber is for integers only (review counts, capacities).
  if (/^\d+[.,]\d{1,2}$/.test(str)) {
    return null;
  }

  const digits = str.replace(/[^\d]/g, '');
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
    normalized.match(/(\d[\d.,\s]*)\s+reviews?/i) ??
    normalized.match(/(\d[\d.,\s]*)\s+rese(?:ñas|nas)?/i) ??
    normalized.match(/\((\d[\d.,\s]*)\)/);

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

  const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
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
  return splitCityInput(rawValues)
    .map((city) => normalizeWhitespace(city))
    .filter(Boolean);
}

export function normalizeUrl(value) {
  return normalizePublicUrl(value);
}

export function stripDiacriticsAndLower(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => normalizeWhitespace(String(value))).filter(Boolean))];
}

export function repairMojibake(value) {
  if (!/[ÃÂâ€™â€œâ€]/.test(value)) {
    return value;
  }

  try {
    return Buffer.from(value, 'latin1').toString('utf8');
  } catch {
    return value;
  }
}
