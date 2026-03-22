import {
  firstNonEmpty,
  mapWithConcurrency,
  parseRatingAndReviews,
  retry,
  stripDiacriticsAndLower,
  stripFieldPrefix,
} from './utils.js';
import { emitRunEvent, RUN_EVENT_TYPES } from './run-events.js';
import { jitteredSleep } from './stealth.js';
import { isEmptyListing } from '../shared/listing-utils.js';

const LISTING_LINK_SELECTOR = 'a[href*="/maps/place/"], a[href*="/place/"]';
const STRONG_POSITIVE_HINT_REGEX =
  /\b(hostel|hostels|hostal|hostals|albergue|alberg|alberg juvenil|youth hostel|backpacker|backpackers)\b/i;
const WEAK_POSITIVE_HINT_REGEX =
  /\b(guest ?house|boarding house|pension|pensio|residencia de estudiantes|residencia estudiantes|residencia universitaria|residencia universitaria resa|student residence|student housing|residence hall|residencia d'estudiants|residencia estudiants)\b/i;
const STRONG_NEGATIVE_HINT_REGEX = /\b(hotel|hotels|resort|resorts|apartahotel|apartment hotel)\b/i;
const WEAK_NEGATIVE_HINT_REGEX =
  /\b(apartment|apartments|vacation rental|holiday apartment|suite|suites|villa|villas)\b/i;
const LOCATION_STOPWORDS = new Set([
  'hostel',
  'hostels',
  'hostal',
  'hostals',
  'hotel',
  'hotels',
  'albergue',
  'alberg',
  'juvenil',
  'guest',
  'house',
  'boarding',
  'pension',
  'pensio',
  'residencia',
  'residence',
  'student',
  'students',
  'universitaria',
  'universitario',
  'resa',
  'backpacker',
  'backpackers',
  'budget',
  'lodging',
  'accommodation',
  'apartments',
  'apartment',
  'rooms',
  'room',
  'center',
  'centre',
  'central',
  'downtown',
  'city',
  'sl',
  'sa',
  'the',
  'and',
  'del',
  'de',
  'la',
  'el',
  'las',
  'los',
  'can',
]);
const STREET_TOKENS = new Set([
  'carrer',
  'calle',
  'avinguda',
  'avenida',
  'av',
  'aving',
  'rambla',
  'passeig',
  'placa',
  'plaza',
  'cami',
  'camino',
  'road',
  'street',
  'st',
  'drive',
  'dr',
  'lane',
  'ln',
  'way',
]);

export const MAX_DETAIL_CONCURRENCY = 3;

export async function scrapeCity(page, detailPage, options) {
  const {
    city,
    queryPrefix,
    resultLimit,
    maxScrollRounds,
    retryCount,
    retryDelayMs,
    detailPauseMs,
    detailConcurrency = 1,
    coordinates,
    onEvent,
  } = options;
  const emit = typeof onEvent === 'function' ? onEvent : () => {};

  const candidateLimit = Math.min(Math.max(resultLimit * 10, resultLimit + 32), 220);
  const searchQueries = buildSearchQueries(queryPrefix, city);
  const seenListingUrls = new Map();
  const results = [];
  const stats = {
    queriesTried: 0,
    uniqueCandidates: 0,
    listingsProcessed: 0,
    listingsAccepted: 0,
    listingsSkipped: 0,
    listingFailures: 0,
  };

  const effectiveConcurrency = Math.min(Math.max(detailConcurrency, 1), MAX_DETAIL_CONCURRENCY);
  const context = page.context();
  let pagePool;
  if (effectiveConcurrency > 1) {
    const extraPages = await Promise.all(Array.from({ length: effectiveConcurrency - 1 }, () => context.newPage()));
    pagePool = [detailPage, ...extraPages];
  } else {
    pagePool = [detailPage];
  }
  let nextPoolSlot = 0;

  try {
    for (const searchQuery of searchQueries) {
      if (results.length >= resultLimit || seenListingUrls.size >= candidateLimit) {
        break;
      }
      stats.queriesTried += 1;

      emitRunEvent(emit, RUN_EVENT_TYPES.CITY_SEARCH_STARTED, {
        city,
        searchQuery,
      });

      await retry(() => openSearchResults(page, searchQuery, coordinates), {
        retries: retryCount,
        delayMs: retryDelayMs,
        label: `open results for ${city}`,
        onEvent: emit,
        eventContext: {
          city,
          searchQuery,
        },
      });

      const listingUrls = await collectListingUrls(page, { candidateLimit, maxScrollRounds });
      const newCandidates = [];
      for (const listingUrl of listingUrls) {
        const key = normalizeMapsUrl(listingUrl);
        if (!seenListingUrls.has(key)) {
          const candidate = { listingUrl, searchQuery };
          seenListingUrls.set(key, candidate);
          newCandidates.push(candidate);
        }

        if (seenListingUrls.size >= candidateLimit) {
          break;
        }
      }

      emitRunEvent(emit, RUN_EVENT_TYPES.CITY_SEARCH_RESULTS, {
        city,
        searchQuery,
        candidateCount: listingUrls.length,
        candidateLimit,
        aggregatedCandidateCount: seenListingUrls.size,
      });
      stats.uniqueCandidates = seenListingUrls.size;

      const candidateBaseIndex = seenListingUrls.size - newCandidates.length;

      // Limit candidates dispatched to avoid exceeding resultLimit under concurrency
      const remainingSlots = resultLimit - results.length;
      const cappedCandidates = newCandidates.slice(0, remainingSlots + effectiveConcurrency);

      await mapWithConcurrency(cappedCandidates, effectiveConcurrency, async (candidate, candidateOffset) => {
        if (results.length >= resultLimit) {
          return;
        }

        const poolSlot = nextPoolSlot;
        nextPoolSlot = (nextPoolSlot + 1) % pagePool.length;
        const workerPage = pagePool[poolSlot];

        const { listingUrl } = candidate;
        const candidateIndex = candidateBaseIndex + candidateOffset + 1;
        stats.listingsProcessed += 1;

        emitRunEvent(emit, RUN_EVENT_TYPES.LISTING_STARTED, {
          city,
          index: candidateIndex,
          totalListings: seenListingUrls.size,
          listingUrl,
        });

        try {
          const item = await retry(() => extractListing(workerPage, listingUrl, city, candidate.searchQuery), {
            retries: retryCount,
            delayMs: retryDelayMs,
            label: `extract listing ${candidateIndex}`,
            onEvent: emit,
            eventContext: {
              city,
              index: candidateIndex,
              totalListings: seenListingUrls.size,
              listingUrl,
            },
          });

          if (isEmptyListing(item)) {
            stats.listingsSkipped += 1;
            emitRunEvent(emit, RUN_EVENT_TYPES.LISTING_SKIPPED, {
              city,
              index: candidateIndex,
              totalListings: seenListingUrls.size,
              listingUrl,
              name: item.name ?? null,
              reason: 'empty-listing',
              score: 0,
              positiveSignals: [],
              negativeSignals: ['no-business-fields'],
            });
            await jitteredSleep(200);
            return;
          }

          const listingMatch = scoreListingMatch(item);
          if (!listingMatch.accepted) {
            stats.listingsSkipped += 1;
            emitRunEvent(emit, RUN_EVENT_TYPES.LISTING_SKIPPED, {
              city,
              index: candidateIndex,
              totalListings: seenListingUrls.size,
              listingUrl,
              name: item.name ?? null,
              reason: listingMatch.reason,
              score: listingMatch.score,
              positiveSignals: listingMatch.positiveSignals,
              negativeSignals: listingMatch.negativeSignals,
            });
            await jitteredSleep(Math.floor(detailPauseMs / 3));
            return;
          }

          results.push(item);
          stats.listingsAccepted += 1;
          await jitteredSleep(detailPauseMs);
        } catch (error) {
          stats.listingFailures += 1;
          emitRunEvent(emit, RUN_EVENT_TYPES.LISTING_FAILED, {
            city,
            index: candidateIndex,
            totalListings: seenListingUrls.size,
            listingUrl,
            message: error?.message ?? String(error),
          });
          await jitteredSleep(detailPauseMs);
        }
      });
    }
  } finally {
    if (effectiveConcurrency > 1) {
      await Promise.allSettled(pagePool.map((p) => p.close()));
    }
  }

  return {
    results,
    stats,
  };
}

async function openSearchResults(page, searchQuery, coordinates) {
  let searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
  if (coordinates?.lat != null && coordinates?.lng != null) {
    const zoom = coordinates.zoom ?? 15;
    searchUrl += `/@${coordinates.lat},${coordinates.lng},${zoom}z`;
  }
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await dismissConsentIfPresent(page);
  await waitForResultsOrDetails(page);
}

async function waitForResultsOrDetails(page) {
  await Promise.race([
    page.locator('[role="feed"]').first().waitFor({ state: 'visible', timeout: 15000 }),
    page.locator('h1').first().waitFor({ state: 'visible', timeout: 15000 }),
  ]).catch(() => {
    throw new Error('Google Maps results did not load in time.');
  });
}

const consentDismissedByContext = new WeakMap();

async function dismissConsentIfPresent(page) {
  const ctx = page.context();
  if (consentDismissedByContext.get(ctx)) {
    return;
  }

  const patterns = [/accept all/i, /i agree/i, /aceptar todo/i, /rechazar todo/i, /accept/i];
  let dismissed = 0;
  const maxDismissals = 3;

  while (dismissed < maxDismissals) {
    let clickedThisPass = false;

    for (const frame of page.frames()) {
      for (const pattern of patterns) {
        const button = frame.getByRole('button', { name: pattern }).first();

        try {
          if (await button.isVisible({ timeout: 1500 })) {
            await button.click({ timeout: 3000 });
            dismissed += 1;
            clickedThisPass = true;
            await jitteredSleep(500);
            break;
          }
        } catch {
          // Ignore absent consent dialogs.
        }
      }

      if (clickedThisPass) {
        break;
      }
    }

    if (!clickedThisPass) {
      break;
    }
  }

  if (dismissed > 0) {
    consentDismissedByContext.set(ctx, true);
  }
}

async function collectListingUrls(page, options) {
  const { candidateLimit, maxScrollRounds } = options;
  const seen = new Map();
  let stagnantRounds = 0;
  let previousCount = 0;

  for (let round = 0; round < maxScrollRounds && seen.size < candidateLimit; round += 1) {
    const urls = await readListingUrls(page);

    for (const url of urls) {
      const key = normalizeMapsUrl(url);
      if (!seen.has(key)) {
        seen.set(key, url);
      }

      if (seen.size >= candidateLimit) {
        break;
      }
    }

    if (seen.size >= candidateLimit) {
      break;
    }

    await scrollResultsPanel(page);
    await waitForScrollContent(page);

    const endOfList = await page
      .locator('[role="feed"] span, div[aria-label*="Results"] span')
      .filter({ hasText: /You[''\u2019]ve reached the end|Has llegado al final/i })
      .count()
      .catch(() => 0);
    if (endOfList > 0) {
      break;
    }

    if (seen.size === previousCount) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
      previousCount = seen.size;
    }

    if (stagnantRounds === 2) {
      await page.mouse.wheel(0, 2500);
      await jitteredSleep(1500);
    } else if (stagnantRounds >= 4) {
      break;
    }
  }

  return [...seen.values()].slice(0, candidateLimit);
}

async function readListingUrls(page) {
  const extractPlaceUrls = (anchors) =>
    anchors.map((a) => a.href).filter((href) => typeof href === 'string' && href.includes('/place/'));

  const feed = page.locator('[role="feed"], div[aria-label*="Results"]').first();

  if (await feed.count()) {
    return feed
      .locator(LISTING_LINK_SELECTOR)
      .evaluateAll(extractPlaceUrls)
      .catch(() => []);
  }

  return page
    .locator(LISTING_LINK_SELECTOR)
    .evaluateAll(extractPlaceUrls)
    .catch(() => []);
}

async function scrollResultsPanel(page) {
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const x = 100 + Math.floor(Math.random() * Math.min(300, viewport.width - 200));
  const y = 200 + Math.floor(Math.random() * Math.min(400, viewport.height - 300));
  await page.mouse.move(x, y).catch(() => {});

  const feed = page.locator('[role="feed"], div[aria-label*="Results"]').first();

  if (await feed.count()) {
    await feed
      .evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      })
      .catch(() => {});
    return;
  }

  await page.mouse.wheel(0, 2500);
}

async function waitForScrollContent(page) {
  const feed = page.locator('[role="feed"], div[aria-label*="Results"]').first();
  if (!(await feed.count())) {
    await jitteredSleep(800);
    return;
  }

  const initialHeight = await feed.evaluate((node) => node.scrollHeight).catch(() => 0);
  const maxWait = 2000;
  const pollInterval = 200;
  let elapsed = 0;

  while (elapsed < maxWait) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;
    const currentHeight = await feed.evaluate((node) => node.scrollHeight).catch(() => 0);
    if (currentHeight > initialHeight) {
      await jitteredSleep(200);
      return;
    }
  }
}

async function extractListing(page, listingUrl, city, searchQuery) {
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded' });
  await dismissConsentIfPresent(page);
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15000 });
  await waitForListingSignals(page);

  /* eslint-disable no-undef -- runs inside Playwright browser context */
  const payload = await page.evaluate(() => {
    const clean = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

    const pickText = (selectors) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const text = clean(element?.textContent ?? '');
        if (text) {
          return text;
        }
      }

      return '';
    };

    const pickHref = (selectors) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const href = element?.href ?? '';
        if (href) {
          return href;
        }
      }

      return '';
    };

    const pickAria = (selectors) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const aria = clean(element?.getAttribute('aria-label') ?? '');
        if (aria) {
          return aria;
        }
      }

      return '';
    };

    return {
      name: pickText(['h1']) || document.title.replace(/\s*[-\u2013]\s*Google Maps.*$/i, '').trim(),
      ratingText:
        pickAria(['span[role="img"][aria-label]', 'div[role="img"][aria-label]']) ||
        pickText([
          'button[jsaction*="pane.rating.moreReviews"]',
          'button[jsaction*="reviewChart.moreReviews"]',
          'div[aria-label*="reviews"]',
        ]),
      reviewText: pickText([
        'button[jsaction*="pane.rating.moreReviews"]',
        'button[jsaction*="reviewChart.moreReviews"]',
        'button[aria-label*="reviews"]',
        'button[aria-label*="rese"]',
      ]),
      category: pickText([
        'button[aria-label*="Category"]',
        'button[jsaction*="pane.rating.category"]',
        'button[aria-label*="Hotel"]',
        'button[aria-label*="Hostel"]',
      ]),
      address: pickText([
        'button[data-item-id="address"]',
        'button[aria-label^="Address"]',
        'button[aria-label^="Dire"]',
      ]),
      addressAria: pickAria([
        'button[data-item-id="address"]',
        'button[aria-label^="Address"]',
        'button[aria-label^="Dire"]',
      ]),
      websiteText: pickText(['a[data-item-id="authority"]', 'a[aria-label^="Website"]', 'a[aria-label^="Sitio web"]']),
      websiteHref: pickHref(['a[data-item-id="authority"]', 'a[aria-label^="Website"]', 'a[aria-label^="Sitio web"]']),
      phone: pickText(['button[data-item-id^="phone"]', 'button[aria-label^="Phone"]', 'button[aria-label^="Tel"]']),
      phoneAria: pickAria([
        'button[data-item-id^="phone"]',
        'button[aria-label^="Phone"]',
        'button[aria-label^="Tel"]',
      ]),
    };
  });
  /* eslint-enable no-undef */

  const ratingInfo = parseRatingAndReviews([payload.ratingText, payload.reviewText].filter(Boolean).join(' '));

  return {
    name: firstNonEmpty(payload.name),
    rating: ratingInfo.rating,
    reviewCount: ratingInfo.reviewCount,
    category: firstNonEmpty(payload.category),
    address: stripFieldPrefix(firstNonEmpty(payload.addressAria, payload.address)),
    website: firstNonEmpty(payload.websiteHref, stripFieldPrefix(payload.websiteText)),
    phone: stripFieldPrefix(firstNonEmpty(payload.phoneAria, payload.phone)),
    googleMapsUrl: page.url(),
    searchedCity: city,
    searchQuery,
  };
}

function normalizeMapsUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function isLikelyHostel(item) {
  return scoreListingMatch(item).accepted;
}

export { isEmptyListing };

export function scoreListingMatch(item) {
  const fields = {
    name: normalizeListingSearchableText([item?.name]),
    category: normalizeListingSearchableText([item?.category]),
    website: normalizeListingSearchableText([item?.website]),
    url: normalizeListingSearchableText([item?.googleMapsUrl]),
    address: normalizeListingSearchableText([item?.address]),
    searchedCity: normalizeListingSearchableText([item?.searchedCity]),
  };

  const positiveSignals = [];
  const negativeSignals = [];
  let score = 0;

  score += scoreSignal(fields.name, STRONG_POSITIVE_HINT_REGEX, 8, 'name-strong-positive', positiveSignals);
  score += scoreSignal(fields.category, STRONG_POSITIVE_HINT_REGEX, 7, 'category-strong-positive', positiveSignals);
  score += scoreSignal(fields.website, STRONG_POSITIVE_HINT_REGEX, 4, 'website-strong-positive', positiveSignals);
  score += scoreSignal(fields.url, STRONG_POSITIVE_HINT_REGEX, 3, 'url-strong-positive', positiveSignals);

  score += scoreSignal(fields.name, WEAK_POSITIVE_HINT_REGEX, 3, 'name-weak-positive', positiveSignals);
  score += scoreSignal(fields.category, WEAK_POSITIVE_HINT_REGEX, 3, 'category-weak-positive', positiveSignals);
  score += scoreSignal(fields.website, WEAK_POSITIVE_HINT_REGEX, 2, 'website-weak-positive', positiveSignals);

  score += scoreSignal(fields.name, STRONG_NEGATIVE_HINT_REGEX, -9, 'name-strong-negative', negativeSignals);
  score += scoreSignal(fields.category, STRONG_NEGATIVE_HINT_REGEX, -8, 'category-strong-negative', negativeSignals);
  score += scoreSignal(fields.website, STRONG_NEGATIVE_HINT_REGEX, -5, 'website-strong-negative', negativeSignals);

  score += scoreSignal(fields.name, WEAK_NEGATIVE_HINT_REGEX, -4, 'name-weak-negative', negativeSignals);
  score += scoreSignal(fields.category, WEAK_NEGATIVE_HINT_REGEX, -4, 'category-weak-negative', negativeSignals);

  score += scoreCityRelevance(fields, positiveSignals, negativeSignals);

  const hasStrongPositive = positiveSignals.some((signal) => signal.includes('strong'));
  const hasStrongNegative = negativeSignals.some((signal) => signal.includes('strong'));
  const accepted = !hasStrongNegative && (score >= 4 || (hasStrongPositive && score > 0));
  const reason = accepted
    ? 'hostel-match'
    : (negativeSignals[0] ?? (positiveSignals.length ? 'low-confidence-hostel-match' : 'no-hostel-signals'));

  return {
    accepted,
    reason,
    score,
    positiveSignals,
    negativeSignals,
  };
}

export function buildSearchQueries(queryPrefix, city) {
  const normalizedCity = `${city ?? ''}`.trim();
  const normalizedPrefix = `${queryPrefix ?? ''}`.trim();
  const primaryQuery = [normalizedPrefix, normalizedCity].filter(Boolean).join(' ');

  if (!primaryQuery) {
    return [];
  }

  const normalizedPrimaryQuery = normalizeListingSearchableText([primaryQuery]);
  const queries = [primaryQuery];

  if (/\b(hostel|hostels|hostal|hostals|albergue|alberg)\b/i.test(normalizedPrimaryQuery)) {
    queries.push(
      `hostal ${normalizedCity}`,
      `albergue ${normalizedCity}`,
      `alberg ${normalizedCity}`,
      `pension ${normalizedCity}`,
      `guest house ${normalizedCity}`,
      `student residence ${normalizedCity}`,
      `residencia estudiantes ${normalizedCity}`,
    );
  }

  return [...new Set(queries.map((value) => value.trim()).filter(Boolean))];
}

function normalizeListingSearchableText(parts) {
  return stripDiacriticsAndLower(parts.filter(Boolean).join(' '));
}

function scoreCityRelevance(fields, positiveSignals, negativeSignals) {
  if (!fields.searchedCity) {
    return 0;
  }

  const cityMatchers = buildCityMatchers(fields.searchedCity);
  if (cityMatchers.tokens.length === 0) {
    return 0;
  }

  const addressCues = extractAddressLocationCues(fields.address);
  const nameCues = extractLocationCues(fields.name);
  const urlCues = extractUrlLocationCues(fields.url);
  const websiteCues = extractUrlLocationCues(fields.website);
  const addressMatches = addressCues.filter((cue) => cueMatchesCity(cue, cityMatchers));
  const otherFieldCues = [...nameCues, ...urlCues, ...websiteCues];
  const otherMatches = otherFieldCues.filter((cue) => cueMatchesCity(cue, cityMatchers));
  let score = 0;

  if (addressMatches.length > 0) {
    positiveSignals.push('address-city-match');
    score += 4;
  }

  if (otherMatches.length > 0) {
    positiveSignals.push('location-city-match');
    score += 2;
  }

  if (addressCues.length > 0 && addressMatches.length === 0) {
    negativeSignals.push('address-strong-negative-other-city');
    score -= 10;
  } else if (addressMatches.length === 0 && otherFieldCues.length > 0 && otherMatches.length === 0) {
    negativeSignals.push('location-strong-negative-other-city');
    score -= 8;
  }

  return score;
}

function buildCityMatchers(searchedCity) {
  const normalizedCity = normalizeLocationSegment(searchedCity);
  const tokens = normalizedCity.split(/\s+/).filter((token) => token.length >= 4);

  return {
    normalizedCity,
    tokens,
  };
}

function cueMatchesCity(cue, cityMatchers) {
  if (!cue) {
    return false;
  }

  if (cue === cityMatchers.normalizedCity) {
    return true;
  }

  const cueTokenSet = new Set(cue.split(/\s+/).filter(Boolean));
  if (cityMatchers.tokens.length === 1) {
    return cueTokenSet.has(cityMatchers.tokens[0]);
  }

  return cityMatchers.tokens.every((token) => cueTokenSet.has(token));
}

function extractAddressLocationCues(value) {
  if (!value) {
    return [];
  }

  const segments = value
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length >= 2) {
    return expandLocationCues(segments.slice(-2));
  }

  if (looksLikeLocalitySegment(segments[0] ?? '')) {
    return expandLocationCues(segments);
  }

  return [];
}

function extractUrlLocationCues(value) {
  if (!value) {
    return [];
  }

  return expandLocationCues([
    value
      .replace(/https?:\/\//g, ' ')
      .replace(/www\./g, ' ')
      .replace(/[?#=&.%]+/g, ' ')
      .replace(/[-_/]+/g, ' ')
      .replace(/\./g, ' '),
  ]);
}

function extractLocationCues(value) {
  if (!value) {
    return [];
  }

  return expandLocationCues(
    value
      .split(/[|/()_-]+/)
      .map((segment) => segment.trim())
      .filter(Boolean),
  );
}

function expandLocationCues(segments) {
  const cues = new Set();

  for (const segment of segments) {
    const normalizedSegment = normalizeLocationSegment(segment);
    if (!normalizedSegment) {
      continue;
    }

    const tokens = normalizedSegment.split(/\s+/).filter((token) => token.length >= 4);

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      cues.add(token);

      const nextPair = tokens.slice(index, index + 2);
      if (nextPair.length === 2) {
        cues.add(nextPair.join(' '));
      }

      const nextTrio = tokens.slice(index, index + 3);
      if (nextTrio.length === 3) {
        cues.add(nextTrio.join(' '));
      }
    }
  }

  return [...cues];
}

function normalizeLocationSegment(value) {
  return `${value ?? ''}`
    .replace(/\d+/g, ' ')
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => !LOCATION_STOPWORDS.has(token))
    .join(' ');
}

function looksLikeLocalitySegment(segment) {
  const normalized = `${segment ?? ''}`.trim();
  if (!normalized || /\d/.test(normalized)) {
    return false;
  }

  const rawTokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (rawTokens.some((token) => STREET_TOKENS.has(token))) {
    return false;
  }

  const cleaned = normalizeLocationSegment(normalized);
  if (!cleaned) {
    return false;
  }

  const cleanedTokens = cleaned.split(/\s+/).filter(Boolean);
  return cleanedTokens.length >= 1 && cleanedTokens.length <= 3;
}

function scoreSignal(value, regex, points, label, collector) {
  if (!value || !regex.test(value)) {
    return 0;
  }

  collector.push(label);
  return points;
}

async function waitForListingSignals(page) {
  await Promise.race([
    page
      .locator(
        'button[data-item-id="address"], ' +
          'button[aria-label^="Address"], ' +
          'button[aria-label^="Dirección"], ' +
          'button[aria-label^="Direccion"], ' +
          'button[aria-label^="Adresse"]',
      )
      .first()
      .waitFor({ state: 'visible', timeout: 5000 }),
    page
      .locator('a[data-item-id="authority"], a[aria-label^="Website"], a[aria-label^="Sitio web"]')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 }),
    page
      .locator('button[data-item-id^="phone"], button[aria-label^="Phone"], button[aria-label^="Tel"]')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 }),
    page
      .locator('button[aria-label*="Category"], button[jsaction*="pane.rating.category"]')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 }),
  ]).catch(() => {});
}
