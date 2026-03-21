# KekaScraper — Improvement Roadmap

Research date: 2026-03-21

Based on a deep-dive analysis of the top open-source Google Maps scraping repos on GitHub,
compared against KekaScraper's current implementation.

---

## Sources Analyzed

| Repo                                       | Stars | Stack                    | URL                                                           |
| ------------------------------------------ | ----- | ------------------------ | ------------------------------------------------------------- |
| gosom/google-maps-scraper                  | 3,439 | Go / Playwright + Rod    | https://github.com/gosom/google-maps-scraper                  |
| omkarcloud/google-maps-scraper             | 2,512 | Python / Botasaurus      | https://github.com/omkarcloud/google-maps-scraper             |
| conor-is-my-name/google-maps-scraper       | 271   | Python / Playwright      | https://github.com/conor-is-my-name/google-maps-scraper       |
| georgekhananaev/google-reviews-scraper-pro | 142   | Python / SeleniumBase UC | https://github.com/georgekhananaev/google-reviews-scraper-pro |
| gaspa93/googlemaps-scraper                 | 496   | Python / Selenium        | https://github.com/gaspa93/googlemaps-scraper                 |

---

## Current Strengths (what we already do better than most)

KekaScraper is already competitive with the top repos. These areas need no change:

- **Stealth**: 5 current UA strings (Chrome 134-136), viewport rotation with deviceScaleFactor,
  `navigator.webdriver` removal, plugin mocking, `--disable-blink-features=AutomationControlled`,
  jittered delays (+/-30%). Most repos have fewer or outdated measures.
- **Consent handling**: Frame iteration (EU iframes) with 3 retry attempts. Most repos only check
  the main frame once.
- **Website enrichment**: Email confidence scoring, decision-maker detection, capacity extraction.
  More sophisticated than any repo analyzed.
- **Hostel filtering**: Unique scoring system with strong/weak positive/negative signals. No other
  repo has domain-specific filtering (they are all general-purpose).
- **Feb 2026 "limited view" bypass**: KekaScraper navigates via search results (not direct place
  URLs), so it is not affected by Google's Feb 2026 change that restricts data on direct place
  pages for unauthenticated users.

---

## Improvement Roadmap

### Difficulty Scale

| Level | Meaning                                 | Typical Effort |
| ----- | --------------------------------------- | -------------- |
| XS    | Tweak a few lines                       | < 1 hour       |
| S     | Small, localized change in 1 file       | 1-3 hours      |
| M     | Multiple files or a new module          | 3-8 hours      |
| L     | Significant new feature or refactor     | 1-2 days       |
| XL    | Architectural change across the project | 2-5 days       |

### Risk Scale

| Level  | Meaning                                               |
| ------ | ----------------------------------------------------- |
| LOW    | Isolated change, no side effects expected             |
| MEDIUM | Touches scraping logic, could affect output accuracy  |
| HIGH   | Touches browser automation core, could break scraping |

---

### Phase 1 — Quick Wins

Low effort, high confidence, can be done independently in any order.

#### 1.1 End-of-Results Early Exit

| Metric         | Value                                                                               |
| -------------- | ----------------------------------------------------------------------------------- |
| **Difficulty** | XS                                                                                  |
| **Risk**       | LOW                                                                                 |
| **Impact**     | Saves 5-15s per city by exiting scroll loop as soon as Google shows no more results |
| **Files**      | `src/lib/maps.js` — `collectListingUrls()` (line ~277)                              |
| **Source**     | conor-is-my-name                                                                    |

**What**: Add a text check for Google's end-of-results marker inside the scroll loop.
When detected, break immediately instead of waiting for 4 stagnant scroll rounds.

**How**: After `readListingUrls()`, check for text content containing
`"You've reached the end of the list"` or the Spanish equivalent
`"Has llegado al final de la lista"` inside the `[role="feed"]` container.
If found, break the loop. This goes right before the stagnation check at line ~298.

**Current behavior** (line 298-310):

```js
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
```

---

#### 1.2 Category Selector: Swap Primary and Fallback Order

| Metric         | Value                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------- |
| **Difficulty** | XS                                                                                                  |
| **Risk**       | LOW                                                                                                 |
| **Impact**     | More resilient to Google Maps UI changes. `jsaction` attributes change more often than `aria-label` |
| **Files**      | `src/lib/maps.js` — `extractListing()` (line ~421) and `waitForListingSignals()` (line ~768)        |
| **Source**     | conor-is-my-name                                                                                    |

**What**: In the category selector array, move `aria-label` selectors before `jsaction`
selectors so they are tried first.

**Current** (line 421-426):

```js
category: pickText([
  'button[jsaction*="pane.rating.category"]',   // fragile, obfuscated
  'button[aria-label*="Category"]',              // stable semantic
  'button[aria-label*="Hotel"]',
  'button[aria-label*="Hostel"]',
]),
```

**Proposed**:

```js
category: pickText([
  'button[aria-label*="Category"]',              // stable semantic — try first
  'button[jsaction*="pane.rating.category"]',    // fallback
  'button[aria-label*="Hotel"]',
  'button[aria-label*="Hostel"]',
]),
```

Same reorder in `waitForListingSignals()` at line 768.

---

#### 1.3 Title Tag as Name Fallback

| Metric         | Value                                               |
| -------------- | --------------------------------------------------- |
| **Difficulty** | XS                                                  |
| **Risk**       | LOW                                                 |
| **Impact**     | Catches edge cases where `<h1>` is empty or delayed |
| **Files**      | `src/lib/maps.js` — `extractListing()` (line ~367)  |
| **Source**     | conor-is-my-name                                    |

**What**: After the `h1` extraction, add a fallback that reads the page `<title>` tag.
Google Maps titles follow the pattern `"Place Name - Google Maps"`.

**How**: Inside the `page.evaluate()` block, after the existing `h1` extraction,
add: `document.title.replace(/\s*[-–]\s*Google Maps.*$/i, '').trim()` as a fallback
if the h1 text is empty.

---

### Phase 2 — New Data Extraction

Moderate effort, extend the data model without touching core scraping logic.

#### 2.1 Social Media Link Extraction

| Metric         | Value                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **Difficulty** | S                                                                                              |
| **Risk**       | LOW                                                                                            |
| **Impact**     | Instagram DMs are a top outreach channel for hostels. Adds linkedin, facebook, twitter, tiktok |
| **Files**      | `src/lib/website-enricher.js`                                                                  |
| **Source**     | omkarcloud (concept — they use external API, we do it locally)                                 |

**What**: During the existing website page crawling (which already visits up to 8 pages per
hostel), scan all `<a href>` attributes for known social media domain patterns.

**Domains to detect**:

```
instagram.com/*, facebook.com/*, linkedin.com/in/*, linkedin.com/company/*,
twitter.com/*, x.com/*, tiktok.com/@*, youtube.com/*
```

**Output fields to add**:

```
instagramUrl, facebookUrl, linkedinUrl, twitterUrl, tiktokUrl, youtubeUrl
```

**Note**: `website-enricher.js` already excludes `instagram.com` and `facebook.com` in its email
domain blocklist (line 641). The crawling infrastructure is already there — just extract and
store the URLs instead of discarding them.

---

#### 2.2 Geo-Coordinate Targeting

| Metric         | Value                                                |
| -------------- | ---------------------------------------------------- |
| **Difficulty** | S-M                                                  |
| **Risk**       | MEDIUM                                               |
| **Impact**     | Better geographic precision, avoids cross-city noise |
| **Files**      | `src/lib/maps.js` — `scrapeCity()`, `src/config.js`  |
| **Source**     | omkarcloud, gosom                                    |

**What**: Allow optional `lat,lng` coordinates per city. When provided, append `/@lat,lng,15z`
to the Google Maps search URL for geographically bounded results.

**How**:

1. Accept optional `coordinates: { lat, lng }` in city config
2. Modify URL construction in `scrapeCity()` to append `/@{lat},{lng},15z`
3. Add a geocoding helper (or accept manual coords) for each city
4. Default zoom level 15 (neighborhood scale), configurable

---

### Phase 3 — Infrastructure Improvements

Bigger changes that improve reliability and scalability.

#### 3.1 Resumable Scraping (Checkpoints)

| Metric         | Value                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------ |
| **Difficulty** | M                                                                                                |
| **Risk**       | LOW                                                                                              |
| **Impact**     | Failed runs resume from last checkpoint instead of restarting. Saves hours on multi-city scrapes |
| **Files**      | `src/lib/run-scrape.js`, new `src/lib/checkpoint.js`                                             |
| **Source**     | gaspa93 (MongoDB), georgekhananaev (SQLite)                                                      |

**What**: Persist scraped results and progress to a local JSON checkpoint file after each city.
On restart, detect existing checkpoint and skip already-completed cities.

**How**:

1. After each city completes, write `{ completedCities: [...], results: [...], timestamp }`
   to `output/<run-id>-checkpoint.json`
2. On startup, check for existing checkpoint matching the same city list
3. Skip cities already in `completedCities`, merge results at the end
4. Delete checkpoint after successful full completion
5. Expose `--resume` CLI flag and "Resume last run" button in Electron UI

---

#### 3.2 Proxy Support

| Metric         | Value                                               |
| -------------- | --------------------------------------------------- |
| **Difficulty** | M                                                   |
| **Risk**       | MEDIUM                                              |
| **Impact**     | Essential for scraping 50+ cities without IP blocks |
| **Files**      | `src/lib/browser.js`, `src/config.js`, `src/cli.js` |
| **Source**     | gosom                                               |

**What**: Add SOCKS5/HTTP/HTTPS proxy support with round-robin rotation.

**How**:

1. Accept `--proxies` CLI flag (comma-separated or file path)
2. Parse proxy URLs: `protocol://user:pass@host:port`
3. Pass to Playwright's `browser.newContext({ proxy: { server, username, password } })`
4. Rotate proxy on each new browser context (round-robin from list)
5. Add proxy field to Electron preferences form
6. Log which proxy is in use per city (without credentials)

**Playwright native support**: `browser.newContext()` already accepts a `proxy` option —
no external dependencies needed.

---

#### 3.3 Concurrent City Processing

| Metric         | Value                                                        |
| -------------- | ------------------------------------------------------------ |
| **Difficulty** | L                                                            |
| **Risk**       | HIGH                                                         |
| **Impact**     | 3-5x speed improvement on multi-city scrapes                 |
| **Files**      | `src/lib/run-scrape.js`, `src/lib/browser.js`                |
| **Source**     | gosom (goroutine pool), conor-is-my-name (configurable tabs) |

**What**: Process multiple cities in parallel using separate browser contexts.

**How**:

1. Add `--concurrency N` CLI flag (default: 1, max: 5)
2. Create N browser contexts (each with its own cookies, proxy if configured)
3. Use a promise pool (`p-limit` or manual) to distribute cities across contexts
4. Each context processes one city at a time, but N cities run simultaneously
5. Merge and deduplicate results after all cities complete
6. Event system must handle concurrent progress emissions (prefix with city name)

**Important**: Requires resumable scraping (#3.1) first — concurrent failures are harder to
recover from without checkpoints.

---

### Phase 4 — Advanced Techniques (Future)

High effort, high reward, but not urgent.

#### 4.1 APP_INITIALIZATION_STATE Parsing

| Metric         | Value                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Difficulty** | L-XL                                                                                                                   |
| **Risk**       | HIGH                                                                                                                   |
| **Impact**     | Extracts 30+ additional fields (coordinates, place_id, hours, popular times, owner info) without fragile DOM selectors |
| **Files**      | New `src/lib/gmaps-state-parser.js`, `src/lib/maps.js`                                                                 |
| **Source**     | omkarcloud, gosom                                                                                                      |

**What**: Parse `window.APP_INITIALIZATION_STATE` — a structured JSON blob that Google Maps
embeds in every page — to extract data from positional arrays.

**Known paths** (from omkarcloud analysis):

```
data[6][11]  = name
data[6][78]  = place_id
data[6][4][7] = rating
data[6][4][8] = review count
data[6][18]  = address
data[6][7][0] = website
data[6][13]  = categories (array)
data[6][37]  = coordinates
data[6][34]  = hours
```

**Risk**: Google can change array positions at any time. Requires a validation layer that
cross-checks extracted values against DOM-based extraction and logs mismatches for
maintenance alerts.

**Recommendation**: Implement as a **secondary extraction path** that enriches existing DOM-based
data, not as a replacement. Use it for fields we can't get from DOM (coordinates, hours,
place_id, popular times).

---

#### 4.2 Zoom-Level Grid Search

| Metric         | Value                                                                |
| -------------- | -------------------------------------------------------------------- |
| **Difficulty** | XL                                                                   |
| **Risk**       | MEDIUM                                                               |
| **Impact**     | 5-10x more results per city by searching at neighborhood granularity |
| **Files**      | New `src/lib/geo-grid.js`, `src/lib/maps.js`                         |
| **Source**     | omkarcloud (closed-source concept)                                   |

**What**: Subdivide a city's bounding box into a grid of cells at zoom level 16-18, search
each cell independently, then deduplicate results.

**Algorithm**:

1. Geocode city name to bounding box (`{north, south, east, west}`)
2. Calculate cell size based on zoom level (~1.4km at zoom 16, ~350m at zoom 18)
3. Generate grid of `(lat, lng)` center points
4. For each cell: search with `/@lat,lng,Nz` appended to URL
5. Deduplicate by normalized Google Maps URL (or KGMID if available)

**Effort**: Requires geocoding API or local database, grid math, and aggressive deduplication
since adjacent cells will overlap. omkarcloud's open-source version does NOT include this —
their grid search is closed-source only.

**Prerequisite**: Geo-coordinate targeting (#2.2) must be implemented first.

---

## Implementation Order (Recommended)

```
Phase 1 — Quick Wins (can do all in one session)
 1.1  End-of-results early exit ............... XS   LOW     ██░░░░░░░░
 1.2  Category selector reorder ............... XS   LOW     █░░░░░░░░░
 1.3  Title tag name fallback ................. XS   LOW     █░░░░░░░░░

Phase 2 — New Data
 2.1  Social media extraction ................. S    LOW     ███░░░░░░░
 2.2  Geo-coordinate targeting ................ S-M  MEDIUM  ████░░░░░░

Phase 3 — Infrastructure
 3.1  Resumable scraping (checkpoints) ........ M    LOW     █████░░░░░
 3.2  Proxy support ........................... M    MEDIUM  █████░░░░░
 3.3  Concurrent city processing .............. L    HIGH    ███████░░░

Phase 4 — Advanced (Future)
 4.1  APP_INITIALIZATION_STATE parsing ........ L-XL HIGH    ████████░░
 4.2  Zoom-level grid search .................. XL   MEDIUM  ██████████

Difficulty bar: █ = ~1 hour of work
```

### Dependencies

```
1.1, 1.2, 1.3 — independent (no dependencies)
2.1 — independent
2.2 → 4.2 (grid search requires geo-coordinates)
3.1 → 3.3 (concurrency needs checkpoints for recovery)
3.2 — independent (but pairs well with 3.3)
4.1 — independent (but informs 4.2 dedup strategy via place_id)
```

---

## Techniques Evaluated and Rejected

| Technique                      | Source           | Why Rejected                                                                                                  |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Regex-on-HTML extraction       | conor-is-my-name | More fragile than live DOM queries. KekaScraper's `page.evaluate()` approach is better                        |
| External API for social media  | omkarcloud       | Adds dependency and cost. Local `<a href>` scanning is simpler and free                                       |
| PostgreSQL job queue           | gosom            | Overkill for a local desktop tool. JSON checkpoints achieve the same goal                                     |
| SeleniumBase Undetected        | georgekhananaev  | Playwright already has good stealth with our custom measures. Switching is unnecessary                        |
| "Is Spending On Ads" detection | omkarcloud       | Uses obfuscated CSS classes (`.kpih0e.f8ia3c.uvopNe`) that change frequently. Low value for hostel outreach   |
| Country-level city enumeration | omkarcloud       | KekaScraper is city-targeted, not country-sweep. Could add later if needed via `geonamescache` npm equivalent |
| KGMID-based deduplication      | omkarcloud       | URL-based dedup already works well. KGMID requires `APP_INITIALIZATION_STATE` parsing (#4.1) first            |
