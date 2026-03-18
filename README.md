# KekaScraper

Reusable Node.js + Playwright scraper for Google Maps hostel searches by city.

## What it does

- Searches Google Maps for `hostels in <city>`
- Iterates through result cards
- Over-samples Google Maps results and filters out listings that look like hotels instead of hostels
- Extracts structured fields when available:
  - `name`
  - `rating`
  - `reviewCount`
  - `category`
  - `address`
  - `website`
  - `phone`
  - `googleMapsUrl`
  - `searchedCity`
  - `searchQuery`
- Enriches the official website when available:
  - `generalEmail`
  - `allFoundEmails`
  - `emailCandidateCount`
  - `emailCandidates`
  - `contactPage`
  - `contactFormUrl`
  - `publicDecisionMakerName`
  - `publicDecisionMakerRole`
  - `publicDecisionMakerEmail`
  - `publicDecisionMakerPhone`
  - `publicDecisionMakerSourceUrl`
  - `bestContactChannel`
  - `bestContactValue`
  - `bestContactSourceUrl`
  - `contactStrategy`
  - `publicContactSourceUrls`
  - `lastSeenAt`
  - `roomCount`
  - `bedCount`
- Writes output to `output/` as JSON and optional CSV

## Requirements

- Windows
- Node.js 22+
- Microsoft Edge installed
- Playwright installed in this project

## Usage

Install dependencies:

```bash
npm install
```

Run for one city:

```bash
npm run scrape -- --cities "Barcelona"
```

Run for multiple cities:

```bash
npm run scrape -- --cities "Barcelona,Bilbao,Donostia" --limit 15 --formats json,csv
```

Run without website enrichment:

```bash
npm run scrape -- --cities "Barcelona" --no-enrich
```

Run in visible browser mode:

```bash
npm run scrape -- --cities "Barcelona" --headful
```

## CLI options

- `--cities "Barcelona,Bilbao"` Comma, semicolon, or newline separated cities
- `--city "Barcelona"` Repeatable single-city flag
- `--limit 20` Max results per city
- `--formats json,csv` Output formats
- `--headful` Launch Edge with UI
- `--slow-mo 250` Slow down actions for debugging
- `--max-scroll-rounds 12` Max scroll rounds on results panel
- `--browser-channel msedge` Browser channel to use
- `--enrich` Enable website enrichment
- `--no-enrich` Disable website enrichment
- `--website-page-limit 4` Max same-domain pages to scan per website

## Notes and limits

- Google Maps DOM changes regularly. Selectors for category, reviews, address, and website are pragmatic fallbacks and may need adjustments over time.
- Some listings do not expose phone, website, or category publicly.
- Hostel filtering is heuristic and based on listing name, category, and URL signals. It reduces hotel noise, but it is not perfect.
- Website enrichment only uses public pages from the property website. It does not rely on LinkedIn or paid APIs.
- `emailCandidates` contains all emails found on the site, ordered by score, with `confidence`, `recommended`, `reasons`, and `sourceUrls`. Only the top-ranked email is marked as `recommended: true`.
- Decision-maker fields are heuristic and populate only when a public page clearly exposes a likely name/role pattern.
- The recommended contact fields are `bestContactChannel`, `bestContactValue`, and `contactStrategy`.
- Room and bed counts are text heuristics and will often be missing.
- Consent screens, anti-bot checks, regional UI variants, and low-result pages can affect reliability.
