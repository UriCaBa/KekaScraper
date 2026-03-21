/**
 * Shared formatting helpers for scraper run events.
 * Browser-safe — no Node.js APIs.
 */

export function formatListingSkipReason(event) {
  const scoreText = typeof event.score === 'number' ? `score=${event.score}` : null;
  const signals = [
    ...(Array.isArray(event.positiveSignals) ? event.positiveSignals : []),
    ...(Array.isArray(event.negativeSignals) ? event.negativeSignals : []),
  ];
  return [event.reason ?? 'skipped', scoreText, signals.length ? `signals=${signals.join(',')}` : null]
    .filter(Boolean)
    .join(' | ');
}
