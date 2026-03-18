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

  try {
    const browser = await chromium.launch({
      channel: browserChannel,
      headless,
      slowMo,
    });

    const context = await browser.newContext({
      locale,
      viewport: { width: 1440, height: 1100 },
    });

    context.setDefaultNavigationTimeout(navigationTimeoutMs);
    context.setDefaultTimeout(actionTimeoutMs);

    return { browser, context };
  } catch (error) {
    throw new Error(
      `Failed to launch Playwright with channel "${browserChannel}". Confirm Microsoft Edge is installed and Playwright can access it. Original error: ${error.message}`,
    );
  }
}
