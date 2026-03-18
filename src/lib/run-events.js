export const RUN_EVENT_TYPES = Object.freeze({
  RUN_STARTED: 'run-started',
  BROWSER_READY: 'browser-ready',
  CITY_STARTED: 'city-started',
  CITY_SEARCH_STARTED: 'city-search-started',
  CITY_SEARCH_RESULTS: 'city-search-results',
  LISTING_STARTED: 'listing-started',
  LISTING_SKIPPED: 'listing-skipped',
  LISTING_FAILED: 'listing-failed',
  RETRYING: 'retrying',
  CITY_COMPLETED: 'city-completed',
  CITY_FAILED: 'city-failed',
  ENRICHMENT_STARTED: 'enrichment-started',
  ENRICHMENT_ITEM_STARTED: 'enrichment-item-started',
  ENRICHMENT_ITEM_SKIPPED: 'enrichment-item-skipped',
  ENRICHMENT_ITEM_COMPLETED: 'enrichment-item-completed',
  ENRICHMENT_ITEM_FAILED: 'enrichment-item-failed',
  WEBSITE_PAGE_SKIPPED: 'website-page-skipped',
  RUN_COMPLETED: 'run-completed',
});

export function createRunEmitter(onEvent) {
  if (typeof onEvent !== 'function') {
    return () => {};
  }

  return (event) => {
    try {
      onEvent({
        ...event,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Ignore observer errors so the scraper can continue.
    }
  };
}

export function emitRunEvent(emit, type, payload = {}) {
  emit({
    type,
    ...payload,
  });
}
