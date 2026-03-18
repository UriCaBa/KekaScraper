# KekaScraper Agent Guide

## Project Summary

KekaScraper is a local lead-generation tool for hostel outreach.

It has two user surfaces:

- a CLI entrypoint in `src/cli.js`
- a local Electron desktop app in `src/electron/main.js`

The app searches Google Maps for hostel listings by city, filters out likely non-hostels, optionally enriches public contact details from the hostel website, and exports results to disk as JSON and/or CSV.

This project is intentionally local-first:

- no external KekaScraper API
- no cloud backend
- no remote database
- all scraping, enrichment, and export happen on the user's machine

## Core Product Rules

- Keep the app fully local and self-contained.
- Do not introduce a hosted backend or dependency on external app services.
- Prefer simple file-based persistence for v1 over adding a database.
- The Electron app should remain approachable for non-technical users.
- The CLI must keep working even as the desktop app evolves.

## Current Architecture

- `src/lib/run-scrape.js`: shared scraper engine used by both CLI and desktop app
- `src/lib/run-options.js`: shared normalization and validation of run options
- `src/cli.js`: CLI wrapper around the shared engine
- `src/electron/`: Electron main process, preload bridge, and local preferences
- `src/ui/`: local desktop UI rendered inside Electron
- `src/lib/maps.js`: Google Maps scraping logic
- `src/lib/website-enricher.js`: optional website enrichment logic
- `src/lib/exporters.js`: JSON/CSV output writing

## Change Guidelines

- Reuse the shared engine instead of duplicating scraping logic across CLI and desktop layers.
- Keep UI-facing error messages clear and non-technical where possible.
- Prefer additive, low-risk refactors over broad rewrites.
- Preserve cross-platform behavior for Windows and macOS in code paths and packaging config.
- Treat Linux support as best-effort for the CLI unless product requirements change.
- Do not silently remove CLI flags or change output field names without updating docs.

## Defensive Defaults

- Do not trust renderer input in Electron. Validate URLs, file paths, and user-provided values again in the main process.
- Keep Electron secure by default: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and deny unexpected navigations or new windows.
- Add a renderer Content Security Policy in local HTML entrypoints instead of relying only on Electron defaults for XSS hardening.
- Open external links only through a safe main-process bridge and only for `http` / `https` URLs.
- Validate local file access against the allowed output directory in the main process, using canonical paths where the boundary matters.
- Create required output directories before opening or writing to them instead of assuming they already exist.
- For critical shared config such as `outputDir`, normalize once near the boundary and reuse the normalized local value across events, exports, and summaries.
- When adding a local normalization helper around shared config, import its fallback source explicitly and return the normalized value itself, not the raw pre-trimmed input.
- If shared option parsing accepts both string and array inputs, apply the same whitespace normalization and de-duplication rules in both paths.
- When refactoring the CLI to call a shared engine, preserve actionable console diagnostics such as per-city failures instead of relying only on the final exit code.
- Before sending IPC events from Electron main to renderer, guard against destroyed windows and destroyed `webContents`.
- Treat `shell.openPath()` as fallible. Check its returned error string and convert failures into explicit errors instead of assuming success.
- Put browser, context, and page lifecycle under `try` / `finally` so Playwright resources are always cleaned up.
- Cleanup code must not mask successful scrape results. Use tolerant teardown patterns such as `Promise.allSettled(...)` or guarded closes.
- Prevent default form submission synchronously during renderer bootstrap. Do not wait for async defaults before attaching the submit guard.
- Validate parsed form state before flipping the desktop UI into a running or disabled state.
- Keep frontend constraints aligned with backend behavior. If the backend requires at least one format or one valid city, the UI must enforce the same rule explicitly.
- When a UI temporarily disables inputs during a run, restore any dynamic validation or checkbox guards when the form becomes interactive again.
- Do not let follow-up UI helpers accidentally re-enable controls that were intentionally disabled for a running job.
- Normalize persisted preferences before hydrating the UI. Treat the local preferences file as untrusted input and fall back field-by-field.
- Persist local preferences atomically when practical: write to a temp file in the same directory and rename it into place instead of overwriting the final JSON path directly.
- Normalize user-facing website values before rendering them as links. Accept common scheme-less hostnames, but still restrict the final rendered URL to safe `http` / `https`.
- When accepting scheme-less website inputs, do not treat a plain `host:port` token as an already-schemed URL. Only treat explicit `http://` or `https://` values as pre-schemed.
- Do not promote placeholder tokens such as `null`, `undefined`, or `n/a` into public URLs. Scheme-less URL normalization should require a plausible hostname.
- Catch rejected IPC calls in renderer event handlers and surface them in visible UI state/logs instead of leaving unhandled promise rejections.
- Keep renderer rendering explicit on hot paths. State helpers such as `appendLog()` should not hide DOM work if the caller already owns the render cadence.
- When the UI shows derived counts for cities or rows, use the same normalization rules as the backend so progress copy and final results stay consistent.
- If the renderer cannot import a backend helper directly, mirror the backend parsing logic in a small, clearly named helper instead of open-coding a "close enough" variant.
- Validate critical renderer inputs again in Electron main using the same parsing rules as the shared backend, not just simple non-empty string checks.
- Treat renderer-provided booleans as untrusted input too. Coerce only real booleans and otherwise fall back to defaults.
- Keep URL normalization consistent across display and enrichment paths. If scheme-less hostnames are accepted in the UI, the backend should normalize them too.
- Avoid `innerHTML` for interactive controls that carry real data in attributes. Prefer DOM creation with `textContent`, closures, or `dataset` set via DOM APIs.
- Final desktop UI state should reconcile from the returned scrape summary, not rely exclusively on streamed IPC progress events.
- Distinguish "no run yet" from "run completed with 0 rows" in the results area so exported files remain accessible after empty runs.
- Separate path containment checks from file-existence checks so missing files return accurate errors instead of looking like boundary violations.
- For local file-opening actions, distinguish clearly between "outside allowed boundary", "output directory missing", and "file missing" instead of collapsing them into one generic path error.
- When checking directory containment with `path.relative()`, do not reject every path that merely starts with `..` as a string. Match real parent traversal (`'..'` or `'..' + path.sep`) so filenames like `..notes.txt` are still treated correctly.
- In run summaries, prioritize failure signal over "empty results" signal so partial failures with zero rows are still reported as partial rather than plain empty.
- If a boundary helper normalizes a config value such as `outputDir`, write that normalized value back into the config object you return so callers, events, and summaries stay consistent.
- If a browser/channel label is user-visible in the CLI or desktop UI, emit a friendly product name such as `Microsoft Edge` instead of raw internal channel ids.
- Shared engine and library layers should not write directly to stdout/stderr for routine progress. Surface progress and warnings through hooks/events so each surface decides what to render.
- If the shared engine stamps event metadata such as `timestamp`, set that metadata after spreading caller-provided fields so upstream payloads cannot overwrite it accidentally.
- UI labels for progress counters must match the actual semantics of the underlying state. If failures are counted too, prefer wording such as `processed` over `completed`.
- Do not send full large result sets over Electron IPC just to render a preview. Return a bounded preview slice plus summary/output paths, and let exports remain the full source of truth.

## Packaging Guardrails

- Keep packaged-app behavior aligned with what is actually shipped, not with local development assumptions.
- Do not expose bundled Chromium in packaged desktop builds unless the build explicitly ships a runnable Playwright browser payload.
- If packaging constraints force a narrower runtime contract, reflect that in the UI, runtime validation, and README at the same time.
- Do not over-constrain `electron-builder` packaged files in a way that drops production dependencies such as `node_modules`.
- If packaged builds rely on system browsers, explicitly exclude Playwright's downloaded browser payload from release artifacts instead of relying on whatever happens to exist locally.
- Do not claim macOS packaging is validated unless it has been built on macOS or on a macOS CI runner.

## Validation Expectations

Before finishing substantial changes, validate what is practical from the current environment:

- `node src/cli.js --help`
- a real CLI smoke run for at least one city when scraping behavior changes
- `npm.cmd start` or equivalent Electron startup smoke test when desktop code changes
- packaging checks when build configuration changes

If a platform cannot be validated locally, say so explicitly instead of implying coverage.

## Packaging Notes

- Windows packaging can be validated from the current environment.
- macOS packaging is a target, but not considered validated unless built on macOS or on a macOS CI runner.
- Unsigned builds are acceptable for now; do not add signing/notarization complexity unless explicitly requested.

## Documentation Hygiene

- Keep README aligned with actual product behavior.
- Document new user-visible options and workflows.
- Prefer concise, implementation-aware docs over aspirational wording.
