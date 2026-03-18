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

  for (const candidate of getLaunchCandidates(browserChannel)) {
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
      `Failed to launch Playwright. Tried ${formatCandidateLabels(getLaunchCandidates(browserChannel))}. ` +
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

  const platformDefaults = process.platform === 'darwin'
    ? ['msedge', 'chrome']
    : ['msedge', 'chrome'];

  return [
    ...platformDefaults.map((channel) => makeChannelCandidate(channel)),
    {
      label: 'bundled Chromium',
      launchOptions: {},
    },
  ];
}

function makeChannelCandidate(channel) {
  return {
    label: channel,
    launchOptions: { channel },
  };
}

function formatCandidateLabels(candidates) {
  return candidates.map((candidate) => `"${candidate.label}"`).join(', ');
}
