import { chromium } from 'playwright';

export async function launchBrowser(options) {
  const {
    browserChannel,
    headless,
    slowMo,
    locale,
    navigationTimeoutMs,
    actionTimeoutMs,
  } = options;

  let browser;
  let launchError;
  let selectedLaunchCandidate;
  const launchCandidates = getLaunchCandidates(browserChannel);

  for (const candidate of launchCandidates) {
    try {
      browser = await chromium.launch({
        ...candidate.launchOptions,
        headless,
        slowMo,
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
    const context = await browser.newContext({
      locale,
      viewport: { width: 1440, height: 1100 },
    });

    context.setDefaultNavigationTimeout(navigationTimeoutMs);
    context.setDefaultTimeout(actionTimeoutMs);

    return { browser, context };
  } catch (error) {
    await browser.close().catch(() => {});
    throw new Error(
      `Failed to create a browser context for ${selectedLaunchCandidate?.label ?? 'the launched browser'}. ` +
      `Requested browser channel: "${browserChannel}". Original error: ${error.message}`,
      { cause: error },
    );
  }
}

function getLaunchCandidates(browserChannel) {
  if (browserChannel && browserChannel !== 'auto') {
    return [makeChannelCandidate(browserChannel)];
  }

  const autoFallbackChannels = ['msedge', 'chrome'];

  return [
    ...autoFallbackChannels.map((channel) => makeChannelCandidate(channel)),
    makeBundledChromiumCandidate(),
  ];
}

function makeChannelCandidate(channel) {
  if (channel === 'chromium') {
    return makeBundledChromiumCandidate('chromium (bundled Chromium)');
  }

  return {
    label: channel,
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
