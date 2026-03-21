import {
  firstNonEmpty,
  mapWithConcurrency,
  normalizeUrl,
  normalizeWhitespace,
  parseNumber,
  retry,
  uniqueNonEmpty,
} from './utils.js';
import { emitRunEvent, RUN_EVENT_TYPES } from './run-events.js';

const WEBSITE_ENRICH_CONCURRENCY = 3;

const CONTACT_KEYWORDS = [
  'contact',
  'contact-us',
  'contacto',
  'contacte',
  'faq',
  'faqs',
  'help',
  'support',
  'about',
  'about-us',
  'aboutus',
  'legal',
  'privacy',
  'terms',
  'cookies',
  'booking',
  'book',
  'reserve',
  'reservation',
  'reservations',
  'service',
  'services',
  'team',
  'equipo',
  'staff',
  'management',
  'leadership',
  'empresa',
  'company',
  'nosotros',
  'nosaltres',
  'who-we-are',
];

const CONTACT_KEYWORDS_REGEX = new RegExp(CONTACT_KEYWORDS.join('|'), 'i');

const ROLE_WORDS = [
  'owner',
  'co-owner',
  'founder',
  'co-founder',
  'ceo',
  'chief executive officer',
  'managing director',
  'director general',
  'director',
  'general manager',
  'property manager',
  'hostel manager',
  'operations manager',
  'head of operations',
  'manager',
  'gerente',
  'gerent',
  'responsable',
  'propietario',
  'propietaria',
  'fundador',
  'fundadora',
];

const NAME_THEN_ROLE_REGEX = new RegExp(
  String.raw`([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})\s*[-,:|]\s*(${ROLE_WORDS.join('|')})`,
  'i',
);

const ROLE_THEN_NAME_REGEX = new RegExp(
  String.raw`(${ROLE_WORDS.join('|')})\s*[-,:|]\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})`,
  'i',
);

export async function enrichListings(listings, options, hooks = {}) {
  const emit = typeof hooks.onEvent === 'function' ? hooks.onEvent : () => {};
  const enrichmentTaskCache = new Map();

  return mapWithConcurrency(listings, WEBSITE_ENRICH_CONCURRENCY, async (listing, index) => {
    emitRunEvent(emit, RUN_EVENT_TYPES.ENRICHMENT_ITEM_STARTED, {
      index: index + 1,
      totalListings: listings.length,
      name: listing.name ?? null,
      website: listing.website ?? null,
    });

    if (!listing.website || !options.enrichWebsite) {
      emitRunEvent(emit, RUN_EVENT_TYPES.ENRICHMENT_ITEM_SKIPPED, {
        index: index + 1,
        totalListings: listings.length,
        name: listing.name ?? null,
        website: listing.website ?? null,
        reason: listing.website ? 'disabled' : 'no-website',
      });
      return withDefaultEnrichment(listing);
    }

    try {
      const urlKey = getEnrichmentCacheKey(listing.website);
      const cacheKey = urlKey ? `${urlKey}::${listing.searchedCity ?? ''}` : null;
      let enrichmentTask = cacheKey ? enrichmentTaskCache.get(cacheKey) : null;

      if (!enrichmentTask) {
        enrichmentTask = retry(() => enrichFromWebsite(listing, options, { onEvent: emit }), {
          retries: options.retryCount,
          delayMs: options.retryDelayMs,
          label: `enrich website ${listing.website}`,
          onEvent: emit,
          eventContext: {
            index: index + 1,
            totalListings: listings.length,
            name: listing.name ?? null,
            website: listing.website ?? null,
          },
        });

        if (cacheKey) {
          enrichmentTaskCache.set(cacheKey, enrichmentTask);
        }
      }

      const enrichment = await enrichmentTask;

      const enrichedListing = {
        ...withDefaultEnrichment(listing),
        ...enrichment,
      };
      emitRunEvent(emit, RUN_EVENT_TYPES.ENRICHMENT_ITEM_COMPLETED, {
        index: index + 1,
        totalListings: listings.length,
        name: listing.name ?? null,
        website: listing.website ?? null,
      });
      return enrichedListing;
    } catch (error) {
      emitRunEvent(emit, RUN_EVENT_TYPES.ENRICHMENT_ITEM_FAILED, {
        index: index + 1,
        totalListings: listings.length,
        name: listing.name ?? null,
        website: listing.website ?? null,
        message: error.message,
      });
      return withDefaultEnrichment(listing, {
        websiteScanStatus: 'failed',
      });
    }
  });
}

async function enrichFromWebsite(listing, options, hooks = {}) {
  const homepageUrl = normalizeUrl(listing.website);
  if (!homepageUrl) {
    throw new Error('Invalid website URL');
  }

  const homepage = await fetchHtmlPage(homepageUrl, options);
  const websiteDomain = new URL(homepage.finalUrl).hostname.replace(/^www\./i, '');
  const { scannedPages, socialLinks } = await crawlWebsite(homepage, options, hooks.onEvent);
  const candidatePages = scannedPages.slice(1).map((page) => page.finalUrl);
  const emailCandidates = buildEmailCandidates(scannedPages, websiteDomain, listing);
  const allPhones = uniqueNonEmpty(scannedPages.flatMap((page) => page.phones));
  const decisionMaker = findDecisionMaker(scannedPages);
  const capacity = findCapacity(scannedPages);
  const generalEmail = emailCandidates.find((candidate) => candidate.recommended)?.email ?? null;
  const contactPage = firstNonEmpty(candidatePages.find((url) => /contact|contacto|contacte/i.test(url)));
  const contactFormPage = findContactFormPage(scannedPages);
  const bestContact = selectBestContact({
    generalEmail,
    contactFormUrl: contactFormPage?.finalUrl ?? null,
    websitePhone: firstNonEmpty(allPhones[0]),
    decisionMaker,
    homepage,
  });
  const now = new Date().toISOString();

  return {
    hostelEmail: generalEmail,
    generalEmail,
    allFoundEmails: emailCandidates.map((candidate) => candidate.email),
    emailCandidateCount: emailCandidates.length,
    emailCandidates,
    contactPage,
    contactFormUrl: contactFormPage?.finalUrl ?? null,
    decisionMakerName: decisionMaker?.name ?? null,
    decisionMakerRole: decisionMaker?.role ?? null,
    decisionMakerEmail: decisionMaker?.email ?? null,
    decisionMakerPhone: decisionMaker?.phone ?? null,
    publicDecisionMakerName: decisionMaker?.name ?? null,
    publicDecisionMakerRole: decisionMaker?.role ?? null,
    publicDecisionMakerEmail: decisionMaker?.email ?? null,
    publicDecisionMakerPhone: decisionMaker?.phone ?? null,
    publicDecisionMakerSourceUrl: decisionMaker?.sourceUrl ?? null,
    roomCount: capacity.roomCount,
    bedCount: capacity.bedCount,
    websitePhone: firstNonEmpty(allPhones[0]),
    bestContactChannel: bestContact.channel,
    bestContactValue: bestContact.value,
    bestContactSourceUrl: bestContact.sourceUrl,
    contactStrategy: bestContact.strategy,
    publicContactSourceUrls: scannedPages.map((page) => page.finalUrl).join(' | '),
    lastSeenAt: now,
    websiteScanStatus: 'ok',
    websitePagesScanned: scannedPages.length,
    websiteScannedUrls: scannedPages.map((page) => page.finalUrl).join(' | '),
    instagramUrl: socialLinks.instagramUrl,
    facebookUrl: socialLinks.facebookUrl,
    linkedinUrl: socialLinks.linkedinUrl,
    twitterUrl: socialLinks.twitterUrl,
    tiktokUrl: socialLinks.tiktokUrl,
    youtubeUrl: socialLinks.youtubeUrl,
  };
}

function withDefaultEnrichment(listing, overrides = {}) {
  return {
    ...listing,
    hostelEmail: null,
    generalEmail: null,
    allFoundEmails: [],
    emailCandidateCount: 0,
    emailCandidates: [],
    contactPage: null,
    contactFormUrl: null,
    decisionMakerName: null,
    decisionMakerRole: null,
    decisionMakerEmail: null,
    decisionMakerPhone: null,
    publicDecisionMakerName: null,
    publicDecisionMakerRole: null,
    publicDecisionMakerEmail: null,
    publicDecisionMakerPhone: null,
    publicDecisionMakerSourceUrl: null,
    roomCount: null,
    bedCount: null,
    websitePhone: null,
    bestContactChannel: listing.phone ? 'phone' : listing.website ? 'website' : null,
    bestContactValue: listing.phone ?? listing.website ?? null,
    bestContactSourceUrl: listing.googleMapsUrl ?? listing.website ?? null,
    contactStrategy: listing.phone
      ? 'Call the public business phone and ask who handles management software.'
      : listing.website
        ? 'Use the public website or website contact page as the first outreach path.'
        : null,
    publicContactSourceUrls: listing.website ?? listing.googleMapsUrl ?? null,
    lastSeenAt: new Date().toISOString(),
    websiteScanStatus: listing.website ? 'skipped' : 'no-website',
    websitePagesScanned: 0,
    websiteScannedUrls: null,
    instagramUrl: null,
    facebookUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    tiktokUrl: null,
    youtubeUrl: null,
    ...overrides,
  };
}

async function fetchHtmlPage(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.websiteFetchTimeoutMs);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': options.websiteUserAgent,
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const charsetMatch = contentType.match(/charset\s*=\s*["']?([^"';\s]+)/i);
    const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8';

    let html;
    if (charset !== 'utf-8' && charset !== 'utf8') {
      try {
        const buffer = await response.arrayBuffer();
        html = new TextDecoder(charset).decode(buffer);
      } catch {
        html = await response.text();
      }
    } else {
      html = await response.text();
    }
    const lines = htmlToLines(html);

    return {
      sourceUrl: url,
      finalUrl: response.url,
      html,
      lines,
      hasForm: /<form\b/i.test(html),
      anchors: extractAnchors(html, response.url),
      emails: mergeEmailSources(extractEmails(html), extractEmails(lines.join(' '))),
      phones: extractPhones(lines.join(' ')),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function crawlWebsite(homepage, options, onEvent = () => {}) {
  const maxPages = Math.max(1, options.websitePageLimit);
  const visited = new Set([normalizePageKey(homepage.finalUrl)]);
  const scannedPages = [homepage];
  const socialLinks = extractSocialLinks(homepage.anchors);
  const queue = scoreAnchors(homepage.finalUrl, homepage.anchors);

  while (scannedPages.length < maxPages && queue.length) {
    queue.sort((left, right) => right.score - left.score || left.url.length - right.url.length);
    const next = queue.shift();

    if (!next) {
      break;
    }

    const pageKey = normalizePageKey(next.url);
    if (visited.has(pageKey)) {
      continue;
    }

    visited.add(pageKey);

    try {
      const page = await fetchHtmlPage(next.url, options);
      scannedPages.push(page);
      mergeSocialLinks(socialLinks, extractSocialLinks(page.anchors));

      const finalKey = normalizePageKey(page.finalUrl);
      if (finalKey !== pageKey) {
        visited.add(finalKey);
      }

      for (const candidate of scoreAnchors(homepage.finalUrl, page.anchors)) {
        if (!visited.has(normalizePageKey(candidate.url))) {
          queue.push(candidate);
        }
      }
    } catch (error) {
      emitRunEvent(onEvent, RUN_EVENT_TYPES.WEBSITE_PAGE_SKIPPED, {
        sourceUrl: homepage.finalUrl,
        url: next.url,
        message: error.message,
      });
    }
  }

  return { scannedPages, socialLinks };
}

function extractAnchors(html, baseUrl) {
  const anchors = [];
  const linkRegex = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(linkRegex)) {
    try {
      anchors.push({
        url: new URL(match[1], baseUrl).toString(),
        text: normalizeWhitespace(stripTags(decodeHtmlEntities(match[2]))),
      });
    } catch {
      // Ignore malformed URLs.
    }
  }

  return anchors;
}

export { extractSocialLinks, extractAnchors, extractMailtoEmails };

const SOCIAL_PATTERNS = [
  { key: 'instagramUrl', pattern: /^https?:\/\/(www\.)?instagram\.com\/[^/?#]+/i },
  { key: 'facebookUrl', pattern: /^https?:\/\/(www\.)?(facebook|fb)\.com\/[^/?#]+/i },
  { key: 'linkedinUrl', pattern: /^https?:\/\/(www\.)?linkedin\.com\/(in|company)\/[^/?#]+/i },
  { key: 'twitterUrl', pattern: /^https?:\/\/(www\.)?(twitter|x)\.com\/[^/?#]+/i },
  { key: 'tiktokUrl', pattern: /^https?:\/\/(www\.)?tiktok\.com\/@[^/?#]+/i },
  { key: 'youtubeUrl', pattern: /^https?:\/\/(www\.)?youtube\.com\/(c\/|channel\/|@)[^/?#]+/i },
];

const SOCIAL_SKIP_PATTERN = /\/sharer\b|\/intent\b|\/share[?/]|\/dialog\b/i;

function extractSocialLinks(anchors) {
  const result = {};
  for (const { key } of SOCIAL_PATTERNS) {
    result[key] = null;
  }

  for (const anchor of anchors) {
    if (SOCIAL_SKIP_PATTERN.test(anchor.url)) {
      continue;
    }

    for (const { key, pattern } of SOCIAL_PATTERNS) {
      if (result[key] === null && pattern.test(anchor.url)) {
        const match = anchor.url.match(pattern);
        if (match) {
          result[key] = match[0];
        }
        break;
      }
    }
  }

  return result;
}

function mergeSocialLinks(target, source) {
  for (const { key } of SOCIAL_PATTERNS) {
    if (target[key] === null && source[key] !== null) {
      target[key] = source[key];
    }
  }
}

function htmlToLines(html) {
  const text = decodeEscapedUnicode(
    decodeHtmlEntities(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<(br|\/p|\/div|\/li|\/section|\/article|\/h\d|\/tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    ),
  );

  return text
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length >= 4);
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#x([0-9a-f]{1,4});/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d{1,5});/g, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, ' ');
}

function mergeEmailSources(...emailArrays) {
  return uniqueNonEmpty(emailArrays.flat());
}

function extractMailtoEmails(html) {
  const decoded = decodeHtmlEntities(decodeEscapedUnicode(html));
  const matches = decoded.match(/mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi) ?? [];
  return matches.map((match) => match.replace(/^mailto:/i, ''));
}

export function extractEmails(value) {
  const normalizedValue = decodeHtmlEntities(decodeEscapedUnicode(value));
  const matches = normalizedValue.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return uniqueNonEmpty(
    matches.filter((email) => {
      if (/\.(png|jpg|jpeg|svg|webp|gif|bmp|ico|css|js|woff|woff2|ttf|eot|map)$/i.test(email)) {
        return false;
      }
      const [localPart, domain] = email.split('@');
      if (!domain) {
        return false;
      }
      if (/\.\./.test(localPart)) {
        return false;
      }
      if (/^[._%+-]|[._%+-]$/.test(localPart)) {
        return false;
      }
      if (/\.\./.test(domain) || /^\./.test(domain) || /\.$/.test(domain)) {
        return false;
      }
      const labels = domain.split('.');
      if (labels.some((label) => !label || /^-/.test(label) || /-$/.test(label))) {
        return false;
      }
      return true;
    }),
  );
}

function extractPhones(value) {
  const matches = value.match(/(?:\+\d{1,3}[\s./-]?)?(?:\(?\d{2,4}\)?[\s./-]?){2,5}\d{2,4}/g) ?? [];
  return uniqueNonEmpty(
    matches
      .map((match) => match.replace(/\s+/g, ' ').trim())
      .filter((match) => match.replace(/[^\d]/g, '').length >= 9)
      .filter((match) => !/^\d{4}-\d{2}-\d{2}/.test(match))
      .filter((match) => !/^\d{4}\s+\d{2}\s+\d{2}/.test(match))
      .filter((match) => /\d{3,}/.test(match)),
  );
}

function findDecisionMaker(scannedPages) {
  for (const page of scannedPages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const line = page.lines[index];
      const nameThenRole = line.match(NAME_THEN_ROLE_REGEX);
      if (nameThenRole) {
        return buildDecisionMakerFromContext(page, index, nameThenRole[1], nameThenRole[2]);
      }

      const roleThenName = line.match(ROLE_THEN_NAME_REGEX);
      if (roleThenName) {
        return buildDecisionMakerFromContext(page, index, roleThenName[2], roleThenName[1]);
      }
    }
  }

  return null;
}

function buildDecisionMakerFromContext(page, lineIndex, name, role) {
  const context = page.lines.slice(Math.max(0, lineIndex - 1), lineIndex + 3).join(' ');
  const emails = extractEmails(context);
  const phones = extractPhones(context);
  const normalizedName = normalizeWhitespace(name);

  return {
    name: normalizedName,
    role: normalizeWhitespace(role),
    email: emails.find((candidate) => emailLooksLikePerson(candidate, normalizedName)) ?? null,
    phone: phones[0] ?? null,
    sourceUrl: page.finalUrl,
  };
}

function emailLooksLikePerson(email, name) {
  const localPart = email.toLowerCase().split('@')[0];
  const parts = name
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= 3);
  return parts.length >= 2 && parts.some((part) => localPart.includes(part.slice(0, 3)));
}

function findCapacity(scannedPages) {
  let roomCount = null;
  let bedCount = null;

  for (const page of scannedPages) {
    if (roomCount === null) {
      roomCount = findCount(page.lines, /\b(\d{1,4})\s+(?:rooms?|habitaciones?|habitacions?)\b/i);
    }

    if (bedCount === null) {
      bedCount = findCount(page.lines, /\b(\d{1,4})\s+(?:beds?|camas?|llits?)\b/i);
    }

    if (roomCount !== null && bedCount !== null) {
      break;
    }
  }

  return { roomCount, bedCount };
}

function findCount(lines, regex) {
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      return parseNumber(match[1]);
    }
  }

  return null;
}

function decodeEscapedUnicode(value) {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    return String.fromCharCode(Number.parseInt(hex, 16));
  });
}

function scoreAnchors(baseUrl, anchors) {
  const base = new URL(baseUrl);
  const byUrl = new Map();

  for (const anchor of anchors) {
    try {
      const target = new URL(anchor.url);
      if (target.origin !== base.origin) {
        continue;
      }

      if (!/^https?:$/i.test(target.protocol)) {
        continue;
      }

      if (/\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|mp4|mp3)$/i.test(target.pathname)) {
        continue;
      }

      const url = target.toString();
      const haystack = `${url} ${anchor.text ?? ''}`;
      const keywordScore = CONTACT_KEYWORDS_REGEX.test(haystack) ? 1 : 0;
      const score = keywordScore * 10 + scoreByPath(url);

      const current = byUrl.get(url);
      if (!current || score > current.score) {
        byUrl.set(url, { url, score });
      }
    } catch {
      // Ignore malformed URLs.
    }
  }

  return [...byUrl.values()];
}

function scoreByPath(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();

    if (path === '/' || path === '') {
      return 1;
    }

    let score = 0;
    const slashCount = (path.match(/\//g) ?? []).length;
    score += Math.max(0, 6 - slashCount);

    if (/faq|contact|about|legal|privacy|terms|booking|reserve|service/.test(path)) {
      score += 8;
    }

    return score;
  } catch {
    return 0;
  }
}

function normalizePageKey(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') || parsed.origin;
  } catch {
    return url;
  }
}

function buildEmailCandidates(scannedPages, websiteDomain, listing) {
  const byEmail = new Map();

  for (const page of scannedPages) {
    for (const email of page.emails) {
      const entry = byEmail.get(email) ?? {
        email,
        sourceUrls: new Set(),
      };

      entry.sourceUrls.add(page.finalUrl);
      byEmail.set(email, entry);
    }
  }

  const ranked = [...byEmail.values()]
    .map((entry) => rankEmailCandidate(entry.email, [...entry.sourceUrls], websiteDomain, listing))
    .sort((left, right) => right.score - left.score || left.email.length - right.email.length);

  const forceRecommend = ranked.length === 1;

  return ranked.map((candidate, index) => ({
    ...candidate,
    recommended: index === 0 || forceRecommend,
  }));
}

function rankEmailCandidate(email, sourceUrls, websiteDomain, listing) {
  const lowerEmail = email.toLowerCase();
  const [, domain = ''] = lowerEmail.split('@');
  const localPart = lowerEmail.split('@')[0] ?? '';
  const cleanDomain = websiteDomain.toLowerCase();
  const websiteRoot = normalizeDomainRoot(cleanDomain);
  const emailRoot = normalizeDomainRoot(domain);
  const cityTokens = buildListingTokens(listing?.searchedCity);
  const nameTokens = buildListingTokens(listing?.name);
  const reasons = [];
  let score = 0;

  if (domain === cleanDomain || domain.endsWith(`.${cleanDomain}`) || cleanDomain.endsWith(`.${domain}`)) {
    score += 50;
    reasons.push('same-domain');
  } else if (emailRoot && websiteRoot && emailRoot === websiteRoot) {
    score += 40;
    reasons.push('same-brand-root');
  } else if (/google\.com$|googlemail\.com$|facebook\.com$|instagram\.com$|cloudflare\.com$/i.test(domain)) {
    score -= 40;
    reasons.push('external-platform-domain');
  } else {
    score -= 15;
    reasons.push('external-domain');
  }

  const preferredPrefixes = [
    'info',
    'hello',
    'contact',
    'booking',
    'bookings',
    'reserv',
    'stay',
    'hostel',
    'admin',
    'sales',
  ];
  if (preferredPrefixes.some((prefix) => localPart.includes(prefix))) {
    score += 20;
    reasons.push('business-prefix');
  }

  if (cityTokens.some((token) => lowerEmail.includes(token))) {
    score += 15;
    reasons.push('matches-city');
  }

  if (nameTokens.some((token) => lowerEmail.includes(token))) {
    score += 8;
    reasons.push('matches-brand');
  }

  const sourceHaystack = sourceUrls.join(' ').toLowerCase();
  if (/contact|contacto|contacte/.test(sourceHaystack)) {
    score += 12;
    reasons.push('found-on-contact-page');
  }

  if (/faq|help|support|legal|privacy|terms|cookies/.test(sourceHaystack)) {
    score += 6;
    reasons.push('found-on-secondary-info-page');
  }

  score += Math.min(10, sourceUrls.length * 3);
  if (sourceUrls.length > 1) {
    reasons.push('found-multiple-times');
  }

  const confidence = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';

  return {
    email,
    score,
    confidence,
    recommended: false,
    reasons,
    sourceUrls,
  };
}

function normalizeDomainRoot(domain) {
  return domain
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/, '')
    .replace(/hostels\b/g, 'hostel')
    .replace(/hotels\b/g, 'hotel');
}

function buildListingTokens(value) {
  return normalizeWhitespace(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function findContactFormPage(scannedPages) {
  return (
    scannedPages.find((page) => page.hasForm && /contact|contacto|contacte|booking|reserv/i.test(page.finalUrl)) ??
    scannedPages.find((page) => page.hasForm)
  );
}

function selectBestContact({ generalEmail, contactFormUrl, websitePhone, decisionMaker, homepage }) {
  if (decisionMaker?.email) {
    return {
      channel: 'public-decision-maker-email',
      value: decisionMaker.email,
      sourceUrl: decisionMaker.sourceUrl ?? homepage.finalUrl,
      strategy: `Use the publicly listed ${decisionMaker.role ?? 'decision-maker'} email with a concise, relevant B2B message.`,
    };
  }

  if (generalEmail) {
    return {
      channel: 'general-email',
      value: generalEmail,
      sourceUrl: homepage.finalUrl,
      strategy: 'Start with the public business email and ask who handles operations, management, or PMS decisions.',
    };
  }

  if (contactFormUrl) {
    return {
      channel: 'contact-form',
      value: contactFormUrl,
      sourceUrl: contactFormUrl,
      strategy:
        'Use the public contact form and ask to be redirected to the person responsible for operations or software.',
    };
  }

  if (websitePhone) {
    return {
      channel: 'phone',
      value: websitePhone,
      sourceUrl: homepage.finalUrl,
      strategy: 'Call the public business number and ask who evaluates hostel management software.',
    };
  }

  return {
    channel: 'website',
    value: homepage.finalUrl,
    sourceUrl: homepage.finalUrl,
    strategy: 'Use the public website as the fallback contact source.',
  };
}

export function getEnrichmentCacheKey(value) {
  const normalizedUrl = normalizeUrl(value);
  if (!normalizedUrl) {
    return null;
  }

  try {
    const parsed = new URL(normalizedUrl);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}
