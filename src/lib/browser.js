import { chromium } from 'playwright';
import { CHROME_USER_AGENTS, VIEWPORT_POOL, STEALTH_INIT_SCRIPT, getStealthLaunchArgs, pickRandom } from './stealth.js';

export async function launchBrowser(options) {
  const {
    browserChannel,
    headless,
    slowMo,
    locale,
    navigationTimeoutMs,
    actionTimeoutMs,
    allowBundledChromium = true,
  } = options;

  let browser;
  let launchError;
  let selectedLaunchCandidate;
  const launchCandidates = getLaunchCandidates(browserChannel, { allowBundledChromium });

  if (launchCandidates.length === 0) {
    const chromiumDisabledReason = describeBundledChromiumDisabledReason({ browserChannel, allowBundledChromium });
    throw new Error(
      `Bundled Chromium is unavailable for requested browser channel "${browserChannel}". ${chromiumDisabledReason}`,
    );
  }

  for (const candidate of launchCandidates) {
    try {
      browser = await chromium.launch({
        ...candidate.launchOptions,
        headless,
        slowMo,
        args: [...(candidate.launchOptions.args ?? []), ...getStealthLaunchArgs()],
      });
      selectedLaunchCandidate = candidate;
      break;
    } catch (error) {
      launchError = error;
    }
  }

  if (!browser) {
    throw new Error(
      `Failed to launch Playwright. Tried ${formatCandidateLabels(launchCandidates)}. ` +
        `Original error: ${launchError?.message ?? 'Unknown launch error.'}`,
      { cause: launchError },
    );
  }

  try {
    const viewport = pickRandom(VIEWPORT_POOL);
    const context = await browser.newContext({
      locale,
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      userAgent: pickRandom(CHROME_USER_AGENTS),
    });

    await context.addInitScript(STEALTH_INIT_SCRIPT);
    context.setDefaultNavigationTimeout(navigationTimeoutMs);
    context.setDefaultTimeout(actionTimeoutMs);

    return {
      browser,
      context,
      launchSummary: {
        requestedBrowserChannel: browserChannel,
        selectedCandidateLabel: selectedLaunchCandidate?.label ?? 'unknown browser',
        viewport: `${viewport.width}x${viewport.height}`,
      },
    };
  } catch (error) {
    await browser.close().catch(() => {});
    throw new Error(
      `Failed to create a browser context for ${selectedLaunchCandidate?.label ?? 'the launched browser'}. ` +
        `Requested browser channel: "${browserChannel}". Original error: ${error.message}`,
      { cause: error },
    );
  }
}

function getLaunchCandidates(browserChannel, { allowBundledChromium = true } = {}) {
  if (browserChannel && browserChannel !== 'auto') {
    if (browserChannel === 'chromium' && !allowBundledChromium) {
      return [];
    }

    return [makeChannelCandidate(browserChannel)];
  }

  const autoFallbackChannels = ['msedge', 'chrome'];

  return [
    ...autoFallbackChannels.map((channel) => makeChannelCandidate(channel)),
    ...(allowBundledChromium ? [makeBundledChromiumCandidate()] : []),
  ];
}

function makeChannelCandidate(channel) {
  if (channel === 'chromium') {
    return makeBundledChromiumCandidate('chromium (bundled Chromium)');
  }

  return {
    label: formatChannelLabel(channel),
    launchOptions: { channel },
  };
}

function makeBundledChromiumCandidate(label = 'bundled Chromium') {
  return {
    label,
    launchOptions: {},
  };
}

function formatCandidateLabels(candidates) {
  return candidates.map((candidate) => `"${candidate.label}"`).join(', ');
}

function formatChannelLabel(channel) {
  switch (channel) {
    case 'msedge':
      return 'Microsoft Edge';
    case 'chrome':
      return 'Google Chrome';
    case 'chromium':
      return 'Chromium';
    default:
      return channel;
  }
}

function describeBundledChromiumDisabledReason({ browserChannel, allowBundledChromium }) {
  if (browserChannel !== 'chromium') {
    return 'Use Auto, Microsoft Edge, or Google Chrome instead.';
  }

  if (!allowBundledChromium) {
    return 'Bundled Chromium is disabled by the current runtime configuration.';
  }

  return 'Bundled Chromium is not available in the current runtime configuration.';
}
