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
