export const STAT_FILTER_FNS = {
  total: () => true,
  withEmail: (r) => Boolean(r.generalEmail),
  withPhone: (r) => Boolean(r.phone || r.websitePhone),
  withDm: (r) => Boolean(r.decisionMakerName),
  enriched: (r) => r.websiteScanStatus === 'ok',
  withSocial: (r) =>
    Boolean(r.instagramUrl || r.facebookUrl || r.linkedinUrl || r.twitterUrl || r.tiktokUrl || r.youtubeUrl),
};

export function computeStats(results) {
  const total = results.length;
  const withEmail = results.filter((r) => r.generalEmail).length;
  const withPhone = results.filter((r) => r.phone || r.websitePhone).length;
  const withDm = results.filter((r) => r.decisionMakerName).length;
  const enriched = results.filter((r) => r.websiteScanStatus === 'ok').length;
  const withSocial = results.filter(STAT_FILTER_FNS.withSocial).length;
  return { total, withEmail, withPhone, withDm, enriched, withSocial };
}

export function filterResults(results, statFilter, searchQuery) {
  let filtered = results;

  if (statFilter && STAT_FILTER_FNS[statFilter]) {
    filtered = filtered.filter(STAT_FILTER_FNS[statFilter]);
  }

  if (!searchQuery) return filtered;

  const query = searchQuery.toLowerCase();
  return filtered.filter((item) => {
    const haystack = [item.name, item.searchedCity, item.generalEmail, item.bestContactValue, item.website]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}
