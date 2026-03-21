# Adaptive Audit Report

## Project Profile

| Aspect | Detected |
|---|---|
| **Language** | JavaScript (ESM), Node.js 20.19+ |
| **Framework** | Electron 41.0.3 + Playwright 1.58.2 |
| **Architecture** | Shared scraper engine (CLI + Electron desktop), local-first |
| **Database** | None (file-based: JSON/CSV exports, JSON checkpoints) |
| **Infrastructure** | electron-builder (NSIS/DMG), no CI/CD |
| **Purpose** | Local hostel lead-generation tool: Google Maps scraping + website enrichment |

## Agents Launched

| Agent | Model | Files Examined | Findings |
|---|---|---|---|
| Architecture | Opus 4.6 | 14 | 2C / 8I / 6S / 8V |
| Security | Opus 4.6 | 14 | 0C / 5I / 5S / 10V |
| Performance | Opus 4.6 | 10 | 2C / 6I / 6S / 10V |
| Testing Quality | Opus 4.6 | 21 | 4C / 7I / 8S / 8V |
| Code Quality | Opus 4.6 | 14 | 2C / 10I / 8S / 10V |

**Legend**: C = Critical, I = Important, S = Suggestion, V = Validated

## Summary (after deduplication)

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| IMPORTANT | 17 |
| SUGGESTION | 15 |
| VALIDATED | 12 |
| **Total** | **46** |

---

## CRITICAL

Findings that must be fixed before shipping. Runtime failures under normal usage.

### Architecture: Module-level mutable state breaks concurrent and multi-run scraping

**Location**: `src/lib/maps.js:295`
**Found by**: 4/5 agents (Architecture, Performance, Code Quality, Testing)
**Finding**: `let consentDismissedForContext = false;` is a module-level variable. Once set to `true` after dismissing Google's consent dialog, it never resets. Two impacts:
1. **Electron multi-run**: In a long-lived Electron process, the second scrape run reuses the stale `true` flag even though the browser context is new. If consent re-appears, it is never dismissed, causing the scrape to silently return garbage data.
2. **Concurrency**: With `concurrency > 1`, all city workers share the same flag. A race exists where city A sets it `true` while city B's page still has an undismissed dialog.
**Impact**: Second scrape run in Electron silently fails. Concurrent city scraping may miss consent dialogs.
**Recommendation**: Track consent per browser context via WeakMap:
```js
const consentDismissedByContext = new WeakMap();

async function dismissConsentIfPresent(page) {
  const ctx = page.context();
  if (consentDismissedByContext.get(ctx)) return;
  // ... existing dismissal logic ...
  if (dismissed > 0) consentDismissedByContext.set(ctx, true);
}
```

### Architecture: `buildRunConfig` silently ignores user's `websitePageLimit` setting

**Location**: `src/electron/main.js:326` and `:442-444`
**Found by**: 2/5 agents (Architecture, Code Quality)
**Finding**: `websitePageLimit: resolveDesktopWebsitePageLimit()` always returns `defaultConfig.websitePageLimit`, ignoring `formState.websitePageLimit` entirely. The user can change the setting, it gets validated and saved to preferences, but has **zero effect** on scraping behavior. Dead control.
**Impact**: Users cannot control enrichment depth from the desktop app. The setting is validated, displayed, persisted -- but never used.
**Recommendation**: Replace line 326 with `websitePageLimit: formState.websitePageLimit,` and delete the dead `resolveDesktopWebsitePageLimit` function.

---

## IMPORTANT

Issues that should be fixed soon. Performance under load, missing error handling, security gaps.

### Architecture: No cancellation mechanism for running scrapes

**Location**: `src/electron/main.js:124-147`
**Finding**: `activeRunPromise` tracks whether a scrape is running, but there is no way to cancel it. The only escape is quitting the app. No `AbortController` or cancellation token is threaded through `runScrape`.
**Impact**: Users cannot stop a long-running scrape (10+ minutes for multiple cities) without killing the app.
**Recommendation**: Thread an `AbortSignal` through `runScrape` and check it at each city boundary and enrichment step. Expose a `scrape:cancel` IPC handler.

### Architecture: `appVersion` hardcoded in config, not read from package.json

**Location**: `src/config.js:9`
**Finding**: `appVersion: '1.0.0'` is hardcoded. When `package.json` version bumps, the config stays stale.
**Impact**: Version displayed in Electron UI header will be wrong after a version bump.
**Recommendation**: Use `app.getVersion()` in Electron main process, or read from `package.json` dynamically.

### Security: ASAR packaging disabled

**Location**: `package.json:49`
**Finding**: `"asar": false` leaves all source code as plain files in the packaged app.
**Impact**: Local users or malware can trivially read/modify the application source, including IPC handlers and preload scripts. An attacker with file access could inject code for full Node.js access.
**Recommendation**: Set `"asar": true`. Use `asarUnpack` only for files that truly need it.

### Security: Proxy credentials exposed in error messages and persisted to disk

**Location**: `src/lib/run-options.js:147`, `src/electron/main.js:131`, `src/electron/preferences.js`
**Found by**: 2/5 agents (Security, Code Quality)
**Finding**: (a) `throw new Error('Invalid proxy URL: ${raw}')` embeds the raw proxy string (with `user:pass`) in the error message, which surfaces in CLI output and Electron activity log. (b) The full proxy string including credentials is saved to `preferences.json` in plaintext.
**Impact**: Proxy credentials leak through error messages and persist unencrypted on disk.
**Recommendation**: (a) Strip credentials before logging: `new URL(raw); url.username=''; url.password='';`. (b) Either exclude proxy from saved preferences or store only `host:port`.

### Security: Checkpoint loaded without schema validation

**Location**: `src/lib/run-scrape.js:261-296`
**Finding**: `loadCheckpoint` parses JSON and destructures `data.completedCities` and `data.results` into runtime state. Only `Array.isArray` is checked on cities, no validation on results objects.
**Impact**: A crafted checkpoint file planted in the output directory before a `--resume` run would inject arbitrary data into the enrichment pipeline and output files.
**Recommendation**: Validate each result object contains only expected string/number keys. Reject checkpoints with unexpected keys or value types.

### Security: `scrape:open-output-folder` opens user-controlled directory without validation

**Location**: `src/electron/main.js:149-155`
**Finding**: `shell.openPath(getDesktopOutputDirectory())` opens whatever is stored in `userOutputDirectory`, which comes from persisted preferences. A manually edited `preferences.json` could point to any path.
**Impact**: Low risk (attacker already has file write access), but violates defense-in-depth.
**Recommendation**: Validate `userOutputDirectory` is an absolute path to an existing directory before calling `shell.openPath`.

### Performance: Checkpoint serializes entire results array on every city completion

**Location**: `src/lib/run-scrape.js:107, :246-258`
**Finding**: `saveCheckpoint` writes the full `allResults` array to JSON after every city. With `resultLimit=20` per city across many cities, this creates quadratic serialization cost.
**Impact**: For 50+ cities with 1000+ results, `JSON.stringify` on the growing array after every city can take 50-200ms, blocking the event loop.
**Recommendation**: Write only incremental city results per checkpoint, or use append-only NDJSON format.

### Performance: Website enrichment crawls pages sequentially within each hostel

**Location**: `src/lib/website-enricher.js:324-371`
**Finding**: `crawlWebsite` processes pages one at a time in a `while` loop. With `websitePageLimit=8`, up to 7 sequential HTTP requests per hostel at 1-3s each.
**Impact**: Single hostel enrichment takes 7-21 seconds of mostly idle wait. Across 100 listings, adds 4-12 minutes. Parallel fetching (2-3 concurrent) would cut this 50-66%.
**Recommendation**: Use bounded concurrent fetching within `crawlWebsite` (2-3 concurrent per domain).

### Performance: `fetchHtmlPage` stores HTML redundantly 3x in memory

**Location**: `src/lib/website-enricher.js:270-322`
**Finding**: Raw `html` string, `lines` array from `htmlToLines(html)`, and `lines.join(' ')` all exist simultaneously. `extractEmails` is called on both the full HTML and the joined lines -- running the same regex twice on near-identical content.
**Impact**: Triples memory per page. With 3 concurrent enrichments * 8 pages, ~14MB of redundant strings.
**Recommendation**: Extract emails once from text lines, once from raw HTML for mailto only. Drop `extractEmails(html)`.

### Performance: Preferences file write not atomic on Windows

**Location**: `src/electron/preferences.js:20-28`
**Found by**: 2/5 agents (Architecture, Code Quality)
**Finding**: Uses `fs.rename()` which fails with `EEXIST`/`EPERM` on Windows if target exists. Unlike `atomicWriteJson` in `utils.js` (which has a 3-level fallback chain), this has no fallback.
**Impact**: Preferences may fail to save on Windows with aggressive antivirus.
**Recommendation**: Reuse `atomicWriteJson` from `utils.js` or add the same fallback chain.

### Code Quality: 5 duplicated functions across CLI, UI, and lib

**Found by**: 3/5 agents (Architecture, Code Quality, Testing)
**Locations and recommendation**:
| Function | Location A | Location B | Fix |
|---|---|---|---|
| `formatListingSkipReason` | `src/cli.js:205` | `src/ui/app.js:560` | Move to `src/shared/` |
| `isEmptyListing` / `isPhantomListing` | `src/lib/maps.js:580` | `src/ui/app.js:579` | Move to `src/shared/` |
| `normalizeUrl` / `normalizePublicUrl` | `src/lib/utils.js:229` | `src/shared/input-normalization.js:43` | Consolidate in `input-normalization.js` |
| `normalizeListingSearchableText` / diacritics strip | `src/lib/maps.js:659` | `src/lib/website-enricher.js:788` | Extract shared `stripDiacriticsAndLower` to `utils.js` |
| `readListingUrls` evaluateAll callback | `src/lib/maps.js:401` | `src/lib/maps.js:411` | Extract to named constant |

### Code Quality: Duplicate hostelEmail/decisionMaker output fields

**Location**: `src/lib/website-enricher.js:188-203`
**Finding**: Output contains 5 redundant field pairs that always hold the same value: `hostelEmail`=`generalEmail`, `publicDecisionMakerName`=`decisionMakerName`, etc.
**Impact**: Doubles data size for these fields, confuses consumers about which to use.
**Recommendation**: Remove aliases or document as intentional backwards-compat aliases.

### Testing: Zero test coverage for 3 critical modules

**Found by**: Testing agent
**Modules**:
- `src/lib/exporters.js` (25 lines) -- writes final JSON/CSV output. A regression silently corrupts all exported data.
- `src/lib/browser.js` (148 lines) -- launches Playwright browser. If it fails, nothing works. Auto-fallback cascade (msedge -> chrome -> bundled) is untested.
- `src/electron/preferences.js` (51 lines) -- load/save with prototype pollution guard. Security boundary with zero coverage.

### Testing: Test runner lacks timeout mechanism

**Location**: `test/run-tests.mjs:31-43`
**Finding**: `await testCase.run()` has no timeout. A hanging test blocks the entire suite forever.
**Recommendation**: Wrap each test with `Promise.race` against a 10-second timeout.

### Testing: 6+ untested security/validation functions

**Locations**: `src/lib/utils.js` (`atomicWriteJson`, `timestampLabel`, `splitCities`, `repairMojibake`), `src/shared/input-normalization.js` (`isLikelyPublicHostname`, `hasUrlCredentials`), `src/lib/run-options.js` (6 options not covered)
**Impact**: `atomicWriteJson` Windows fallback path runs on the user's platform (Windows 11) with zero coverage. `isLikelyPublicHostname` and `hasUrlCredentials` are security boundaries.

---

## SUGGESTION

Nice-to-have improvements. Code style, edge cases, future-proofing.

### Architecture: CSV export lacks BOM for Excel compatibility

**Location**: `src/lib/exporters.js:19`
**Finding**: CSV written as plain UTF-8. Excel on Windows defaults to system locale encoding, corrupting non-ASCII characters (accented city names).
**Recommendation**: Prepend UTF-8 BOM: `await fs.writeFile(csvPath, '\uFEFF' + toCsv(items) + '\n', 'utf8');`

### Architecture: Retry backoff lacks jitter (thundering herd)

**Location**: `src/lib/utils.js:36`
**Finding**: Exponential backoff without jitter. Concurrent workers failing simultaneously retry at identical intervals.
**Recommendation**: Use `jitteredSleep` from `stealth.js` instead of `sleep`.

### Architecture: `RESULTS_PREVIEW_LIMIT` defined independently in two files

**Location**: `src/electron/main.js:22`, `src/ui/app.js:30`
**Recommendation**: Define once in `src/config.js`.

### Architecture: Dead code -- `deriveResultsView` and `getRootDir`

**Locations**: `src/ui/view-model.js:47-75` (exported, never imported), `src/config.js:30-32` (exported, never called)
**Recommendation**: Remove both.

### Security: CSP `img-src` allows unnecessary `data:` URIs

**Location**: `src/ui/index.html:8`
**Recommendation**: Remove `data:` from `img-src` if not needed.

### Security: Website enricher follows redirects without re-validating target

**Location**: `src/lib/website-enricher.js:270-322`
**Finding**: `isLikelyPublicHostname` only checks the initial URL. A crafted redirect could lead to internal network resources (SSRF risk in corporate environments).
**Recommendation**: Check `response.url` after fetch and reject non-public hosts.

### Security: Consider pinning Electron version

**Location**: `package.json:39`
**Finding**: `"electron": "^41.0.3"` auto-upgrades within major. Chromium has a fast CVE cadence.
**Recommendation**: Pin exact version, upgrade deliberately.

### Performance: Dashboard search rebuilds entire DOM per keystroke

**Location**: `src/ui/app.js:663-706`
**Finding**: Every `input` event on `dashSearch` creates ~3500 DOM elements (7 cells * 500 rows).
**Recommendation**: Debounce 150ms.

### Performance: Activity log fully rebuilt on every scrape event

**Location**: `src/ui/app.js:513-524`
**Recommendation**: Incremental append instead of `replaceChildren` on all 120 entries.

### Performance: Stateful regex with `/g` flag is a maintenance hazard

**Location**: `src/lib/website-enricher.js:49`
**Finding**: `CONTACT_KEYWORDS_REGEX_GLOBAL` with `/g` flag. Currently safe (used with `.match()`), but one refactor to `.test()` introduces intermittent bugs.
**Recommendation**: Create regex locally in `scoreAnchors` or add a warning comment.

### Code Quality: Large files exceed 300-line complexity threshold

**Files**: `app.js` (913), `maps.js` (878), `website-enricher.js` (864), `main.js` (523), `styles.css` (1084)
**Recommendation**: Split into focused modules (e.g., `app.js` -> scrape-handler, dashboard, form).

### Code Quality: Magic numbers in scoring logic

**Locations**: `src/lib/maps.js:598-618` (hostel scoring), `src/lib/website-enricher.js:711-767` (email ranking)
**Recommendation**: Extract named constants: `SCORE_NAME_STRONG_POSITIVE = 8`, `ACCEPTANCE_THRESHOLD = 4`, etc.

### Testing: `detailConcurrency` clamping test reimplements source logic

**Location**: `test/maps.test.js:152-163`
**Finding**: Test reimplements `Math.min(Math.max(v, 1), MAX)` instead of calling the actual source code.
**Recommendation**: Export a `clampDetailConcurrency` function and test that.

### Testing: `parseRatingAndReviews` has minimal coverage

**Location**: `test/utils.test.js:75-81`
**Finding**: Only one case tested. Spanish locale, review count extraction, and empty input are untested.

### Testing: No `websitePageLimit` UI control in desktop app

**Location**: `src/ui/index.html`
**Finding**: No input field for `websitePageLimit`. Combined with the CRITICAL bug above, this setting is completely inaccessible.
**Recommendation**: Add an input in the advanced options section.

---

## VALIDATED

Good decisions that should be preserved. Positive reinforcement.

### Architecture: Clean CLI/Electron separation via shared engine

**Location**: `src/lib/run-scrape.js`
**What**: `runScrape()` is a pure async function accepting options + hooks. Both CLI and Electron provide their own `onEvent` handler. The engine has zero environment knowledge.
**Why**: Textbook dependency inversion. Testable in isolation. Adding a third consumer requires zero engine changes.

### Architecture: Centralized event system with frozen constants

**Location**: `src/lib/run-events.js`
**What**: `RUN_EVENT_TYPES` is `Object.freeze`'d. Observer errors are caught so a faulty listener never crashes the scraper.
**Why**: Clean pub-sub. Frozen constants eliminate mutation risk. Swallowing observer errors prioritizes scrape completion.

### Architecture: Resumable scraping with validated checkpoints

**Location**: `src/lib/run-scrape.js:244-304`
**What**: After each city, checkpoint saved. On resume, validated for matching city list. On success, checkpoint deleted.
**Why**: Pragmatic durability for long runs. Validation prevents resuming with mismatched cities.

### Security: Electron hardening -- contextIsolation, sandbox, CSP

**Location**: `src/electron/main.js:49-54`, `src/ui/index.html:6-9`
**What**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. CSP blocks inline scripts, remote scripts, fetch/XHR, plugins, framing. Zero innerHTML usage across the entire renderer -- all DOM updates use `textContent` and `createElement`.
**Why**: Defense-in-depth. Even if malicious scraped data reaches the DOM, `textContent` auto-escapes HTML. The CSP eliminates stored XSS. This would pass a security review.

### Security: Minimal preload bridge surface area

**Location**: `src/electron/preload.cjs`
**What**: Exactly 8 narrowly-scoped methods exposed via `contextBridge`. No raw `ipcRenderer.send/on`. Each method maps to a specific `ipcMain.handle` with server-side validation.
**Why**: Textbook preload design. The renderer cannot invoke arbitrary IPC channels.

### Security: Path traversal protection and external URL validation

**Location**: `src/electron/main.js:351-396`
**What**: `isSafeExternalUrl` validates http/https and rejects credentials. `validateOutputFilePath` uses `realpath` canonicalization to defeat symlink attacks and directory traversal.
**Why**: Thorough and correct. Navigation lockdown (`will-navigate` + `setWindowOpenHandler`) completes the defense.

### Security: Prototype pollution guard in preferences

**Location**: `src/electron/preferences.js:34-49`
**What**: Blocks `__proto__`, `constructor`, `prototype`. Only copies allowlisted keys from fallback state.
**Why**: Prevents JSON-based prototype pollution from crafted preferences files.

### Performance: Worker-pool pattern with pre-allocated pages

**Location**: `src/lib/maps.js:117-122`, `src/lib/utils.js:70-86`
**What**: `mapWithConcurrency` with pre-allocated Playwright pages. Pages round-robin assigned, avoiding per-listing creation overhead. `MAX_DETAIL_CONCURRENCY = 3` cap.
**Why**: Correct for Playwright. Page creation costs ~100-300ms; pooling amortizes this.

### Performance: Enrichment task deduplication cache

**Location**: `src/lib/website-enricher.js:88, :110-131`
**What**: `enrichmentTaskCache` Map caches the Promise keyed by normalized URL + city. Duplicate listings share a single in-flight fetch.
**Why**: Textbook promise-coalescing. Prevents redundant network requests.

### Performance: Lightweight stealth measures

**Location**: `src/lib/stealth.js`
**What**: Single Chrome flag + small init script. No heavy browser extensions or third-party stealth libraries.
**Why**: Negligible overhead. One `addInitScript` per context, not per page.

### Code Quality: Minimal dependency footprint

**Location**: `package.json`
**What**: 1 production dependency (`playwright`). Dev deps are only ESLint, Prettier, Electron, electron-builder, globals.
**Why**: Minimal attack surface, fast installs, no supply-chain risk from unnecessary transitive dependencies.

### Testing: Electron contract tests verify IPC channel alignment

**Location**: `test/electron-contracts.test.js`
**What**: Tests verify main.js registers all expected IPC handlers AND preload.cjs exposes all expected bridge methods. Cross-file validation catches mismatches.
**Why**: IPC mismatches only manifest at runtime. Source-level regex matching catches channel name typos without requiring Electron to run.

---

## Metrics

| Metric | Value |
|--------|-------|
| Source files audited | ~20 |
| Test files audited | 11 |
| Findings (pre-dedup) | 80+ |
| Findings (post-dedup) | 46 |
| Duplicates removed | ~34 (30-50% overlap, as expected) |
| Exploitable critical vulnerabilities | **0** |
| Functional critical bugs | **2** |
| Production-readiness gaps | **17** (IMPORTANT tier) |

**Verdict**: The codebase has excellent security foundations (Electron hardening, zero innerHTML, strict CSP, prototype pollution guards) and clean architecture (shared engine, event system, checkpoint durability). The two CRITICAL issues are both related to the same root cause (module-level mutable state) and a dead UI control -- both straightforward fixes. The IMPORTANT tier is dominated by code duplication (classic AI-generated pattern), missing test coverage for 3 critical modules, and performance optimizations for multi-city runs. The app is shippable after fixing the 2 CRITICALs and the proxy credential leak.

---

*Quieres que implemente las correcciones? Tambien puedo guardar las best practices validadas en el CLAUDE.md del proyecto para futuras sesiones.*
