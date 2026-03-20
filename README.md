# KekaScraper

Reusable local scraper for Google Maps hostel searches by city, with both a CLI and a desktop app.

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
- Writes output locally:
  - CLI runs default to JSON in `output/`
  - the desktop app writes to your Documents folder under `KekaScraper/output`
- Includes a local Electron desktop app for non-technical users targeting Windows and macOS

## Requirements

- Windows, macOS, or Linux
- Node.js 22+
- Playwright installed in this project
- One supported Chromium-based browser available:
  - preferred: Microsoft Edge
  - fallback: Google Chrome
  - CLI and local development can also use Playwright bundled Chromium
  - packaged desktop builds currently expect Edge or Chrome to be installed on the machine
  - Linux is expected to use Playwright bundled Chromium unless you install a supported browser channel

## Desktop app

Start the local desktop app:

```bash
npm run start
```

Package the desktop app:

```bash
npm run pack
```

Create installable artifacts:

```bash
npm run dist
```

The desktop app stores exported results in your Documents folder under `KekaScraper/output` and remembers the last basic settings locally on the same machine.
It defaults to JSON output to match the CLI. Enable CSV explicitly in the form when you need it.
Website enrichment in the desktop app scans hostel sites automatically; there is no separate per-site page limit field in the UI.
Current packaged desktop builds are configured around system browsers. For the smoothest first-run experience on client machines, keep Microsoft Edge or Google Chrome installed and use `Auto`, `Microsoft Edge`, or `Google Chrome` in the app.

## CLI usage

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
npm run scrape -- --cities "Barcelona;Bilbao;Donostia" --limit 15 --formats json,csv
```

Run without website enrichment:

```bash
npm run scrape -- --cities "Barcelona" --no-enrich
```

Run in visible browser mode:

```bash
npm run scrape -- --cities "Barcelona" --headful
```

## Smoke tests

Use the renderer smoke test when you want a stable Playwright check of the desktop UI logic without launching Electron:

```bash
npm run smoke:renderer
```

Use the Electron smoke test on a real local desktop session when you want to validate the packaged app shell, preload bridge, and renderer together:

```bash
npm run smoke:electron
```

`smoke:renderer` uses a fake desktop bridge and a local static server, so it is suitable for CI or restricted environments where Electron windows cannot open.
`smoke:electron` launches the actual Electron app in `KEKA_SMOKE_MODE=1`, which avoids real scraping and browser automation against Google Maps, but it still requires GUI access.

## CLI options

- `--cities "Barcelona;Bilbao"` Semicolon or newline separated cities
- `--city "Barcelona"` Repeatable single-city flag
- `--limit 20` Max results per city
- `--formats json,csv` Output formats
- `--headful` Launch the browser with UI
- `--slow-mo 250` Slow down actions for debugging
- `--max-scroll-rounds 12` Max scroll rounds on results panel
- `--browser-channel auto|msedge|chrome|chromium` Browser channel to use, or bundled Chromium
- `--enrich` Enable website enrichment
- `--no-enrich` Disable website enrichment
- `--website-page-limit 8` Max same-domain pages to scan per website

## Notes and limits

- Google Maps DOM changes regularly. Selectors for category, reviews, address, and website are pragmatic fallbacks and may need adjustments over time.
- Browser launch is cross-platform. By default the scraper tries Edge first, then Chrome, then bundled Chromium. On Linux, the most portable setup is usually Playwright bundled Chromium. You can still force a browser with `--browser-channel`.
- City lists should use newlines or semicolons as separators. Commas are preserved inside a city token so inputs such as `Paris, France` stay intact.
- Packaged desktop builds currently use system browsers only. The CLI and unpackaged local development runs can still use Playwright bundled Chromium.
- The desktop app is fully local. It does not call any external KekaScraper API or cloud backend.
- Windows packaging is validated from the current development environment. macOS remains a target, but it is not considered validated until the app is built on macOS or on a macOS runner.
- Some listings do not expose phone, website, or category publicly.
- Hostel filtering is heuristic and based on listing name, category, and URL signals. It reduces hotel noise, but it is not perfect.
- Website enrichment only uses public pages from the property website. It does not rely on LinkedIn or paid APIs.
- `emailCandidates` contains all emails found on the site, ordered by score, with `confidence`, `recommended`, `reasons`, and `sourceUrls`. Only the top-ranked email is marked as `recommended: true`.
- Decision-maker fields are heuristic and populate only when a public page clearly exposes a likely name/role pattern.
- The recommended contact fields are `bestContactChannel`, `bestContactValue`, and `contactStrategy`.
- Room and bed counts are text heuristics and will often be missing.
- Consent screens, anti-bot checks, regional UI variants, and low-result pages can affect reliability.
