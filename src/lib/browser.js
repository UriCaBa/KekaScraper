import process from 'node:process';
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
  const launchCandidates = getLaunchCandidates(browserChannel);

  for (const candidate of launchCandidates) {
    try {
      browser = await chromium.launch({
        ...candidate.launchOptions,
        headless,
        slowMo,
      });
      break;
    } catch (error) {
      launchError = error;
    }
  }

  if (!browser) {
    throw new Error(
      `Failed to launch Playwright. Tried ${formatCandidateLabels(launchCandidates)}. ` +
      `Original error: ${launchError?.message ?? 'Unknown launch error.'}`,
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
    throw error;
  }
}

function getLaunchCandidates(browserChannel) {
  if (browserChannel && browserChannel !== 'auto') {
    return [makeChannelCandidate(browserChannel)];
  }

  const platformDefaults = ['msedge', 'chrome'];

  return [
    ...platformDefaults.map((channel) => makeChannelCandidate(channel)),
    makeBundledChromiumCandidate(),
  ];
}

function makeChannelCandidate(channel) {
  if (channel === 'chromium') {
    return makeBundledChromiumCandidate();
  }

  return {
    label: channel,
    launchOptions: { channel },
  };
}

function makeBundledChromiumCandidate() {
  return {
    label: 'bundled Chromium',
    launchOptions: {},
  };
}

function formatCandidateLabels(candidates) {
  return candidates.map((candidate) => `"${candidate.label}"`).join(', ');
}
