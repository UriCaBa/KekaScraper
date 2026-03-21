/**
 * Shared listing classification helpers.
 * Browser-safe — no Node.js APIs.
 */

export function isEmptyListing(item) {
  return !item.address && !item.website && !item.phone && !item.category;
}
