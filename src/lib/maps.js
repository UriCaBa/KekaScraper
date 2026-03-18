import { firstNonEmpty, parseRatingAndReviews, retry, sleep, stripFieldPrefix } from './utils.js';
import { emitRunEvent, RUN_EVENT_TYPES } from './run-events.js';

const LISTING_LINK_SELECTOR = 'a[href*="/maps/place/"], a[href*="/place/"]';
const HOSTEL_HINT_REGEX = /\b(hostel|hostels|albergue|alberg|youth hostel|backpacker)\b/i;
const NON_HOSTEL_HINT_REGEX = /\b(hotel|hotels|resort|apartment|apartments|apartahotel)\b/i;

export async function scrapeCity(page, detailPage, options) {
  const {
    city,
    queryPrefix,
    resultLimit,
    maxScrollRounds,
    retryCount,
    retryDelayMs,
    detailPauseMs,
    onEvent,
  } = options;
  const emit = typeof onEvent === 'function' ? onEvent : () => {};

  const searchQuery = `${queryPrefix} ${city}`;
  emitRunEvent(emit, RUN_EVENT_TYPES.CITY_SEARCH_STARTED, {
    city,
    searchQuery,
  });

  await retry(
    () => openSearchResults(page, searchQuery),
    {
      retries: retryCount,
      delayMs: retryDelayMs,
      label: `open results for ${city}`,
      onEvent: emit,
      eventContext: {
        city,
        searchQuery,
      },
    },
  );

  const candidateLimit = Math.min(Math.max(resultLimit * 4, resultLimit + 8), 80);
  const listingUrls = await collectListingUrls(page, { resultLimit, maxScrollRounds });
  emitRunEvent(emit, RUN_EVENT_TYPES.CITY_SEARCH_RESULTS, {
    city,
    searchQuery,
    candidateCount: listingUrls.length,
    candidateLimit,
  });

  const results = [];
  const candidateUrls = listingUrls.slice(0, candidateLimit);

  for (const [index, listingUrl] of candidateUrls.entries()) {
    emitRunEvent(emit, RUN_EVENT_TYPES.LISTING_STARTED, {
      city,
      index: index + 1,
      totalListings: candidateUrls.length,
      listingUrl,
    });

    try {
      const item = await retry(
        () => extractListing(detailPage, listingUrl, city, searchQuery),
        {
          retries: retryCount,
          delayMs: retryDelayMs,
          label: `extract listing ${index + 1}`,
          onEvent: emit,
          eventContext: {
            city,
            index: index + 1,
            totalListings: candidateUrls.length,
            listingUrl,
          },
        },
      );

      if (!isLikelyHostel(item)) {
        emitRunEvent(emit, RUN_EVENT_TYPES.LISTING_SKIPPED, {
          city,
          index: index + 1,
          totalListings: candidateUrls.length,
          listingUrl,
          name: item.name ?? null,
          reason: 'non-hostel',
        });
        await sleep(detailPauseMs);
        continue;
      }

      results.push(item);
      await sleep(detailPauseMs);

      if (results.length >= resultLimit) {
        break;
      }
    } catch (error) {
      emitRunEvent(emit, RUN_EVENT_TYPES.LISTING_FAILED, {
        city,
        index: index + 1,
        totalListings: candidateUrls.length,
        listingUrl,
        message: error.message,
      });
    }
  }

  return results;
}

async function openSearchResults(page, searchQuery) {
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
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

async function dismissConsentIfPresent(page) {
  const patterns = [
    /accept all/i,
    /i agree/i,
    /aceptar todo/i,
    /rechazar todo/i,
    /accept/i,
  ];

  for (const frame of page.frames()) {
    for (const pattern of patterns) {
      const button = frame.getByRole('button', { name: pattern }).first();

      try {
        if (await button.isVisible({ timeout: 1500 })) {
          await button.click({ timeout: 3000 });
          await sleep(1000);
          return;
        }
      } catch {
        // Ignore absent consent dialogs.
      }
    }
  }
}

async function collectListingUrls(page, options) {
  const { resultLimit, maxScrollRounds } = options;
  const candidateLimit = Math.min(Math.max(resultLimit * 4, resultLimit + 8), 80);
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
    await sleep(1250);

    if (seen.size === previousCount) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
      previousCount = seen.size;
    }

    if (stagnantRounds >= 3) {
      break;
    }
  }

  return [...seen.values()].slice(0, candidateLimit);
}

async function readListingUrls(page) {
  const feed = page.locator('[role="feed"]').first();

  if (await feed.count()) {
    return feed.locator(LISTING_LINK_SELECTOR).evaluateAll((anchors) => {
      return anchors
        .map((anchor) => anchor.href)
        .filter((href) => typeof href === 'string' && href.includes('/place/'));
    }).catch(() => []);
  }

  return page.locator(LISTING_LINK_SELECTOR).evaluateAll((anchors) => {
    return anchors
      .map((anchor) => anchor.href)
      .filter((href) => typeof href === 'string' && href.includes('/place/'));
  }).catch(() => []);
}

async function scrollResultsPanel(page) {
  const feed = page.locator('[role="feed"]').first();

  if (await feed.count()) {
    await feed.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    }).catch(() => {});
    return;
  }

  await page.mouse.wheel(0, 2500);
}

async function extractListing(page, listingUrl, city, searchQuery) {
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded' });
  await dismissConsentIfPresent(page);
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15000 });
  await sleep(1200);

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
      name: pickText(['h1']),
      ratingText: pickAria([
        'span[role="img"][aria-label]',
        'div[role="img"][aria-label]',
      ]) || pickText([
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
        'button[jsaction*="pane.rating.category"]',
        'button[aria-label*="Category"]',
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
      websiteText: pickText([
        'a[data-item-id="authority"]',
        'a[aria-label^="Website"]',
        'a[aria-label^="Sitio web"]',
      ]),
      websiteHref: pickHref([
        'a[data-item-id="authority"]',
        'a[aria-label^="Website"]',
        'a[aria-label^="Sitio web"]',
      ]),
      phone: pickText([
        'button[data-item-id^="phone"]',
        'button[aria-label^="Phone"]',
        'button[aria-label^="Tel"]',
      ]),
      phoneAria: pickAria([
        'button[data-item-id^="phone"]',
        'button[aria-label^="Phone"]',
        'button[aria-label^="Tel"]',
      ]),
    };
  });

  const ratingInfo = parseRatingAndReviews(
    [payload.ratingText, payload.reviewText].filter(Boolean).join(' '),
  );

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

function isLikelyHostel(item) {
  const searchable = [
    item.name,
    item.category,
    item.website,
    item.googleMapsUrl,
  ]
    .filter(Boolean)
    .join(' ');

  if (HOSTEL_HINT_REGEX.test(searchable)) {
    return true;
  }

  if (NON_HOSTEL_HINT_REGEX.test(searchable)) {
    return false;
  }

  return false;
}
