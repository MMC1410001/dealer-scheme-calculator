// Browser suite for the admin area and the iframe dealer view (qa/README.md, Step 4b). The API suite
// (playwright.config.js) stays browser-free. This suite uses the installed Google Chrome (channel "chrome"),
// so it needs no browser download. Set PW_CHANNEL= (empty) to use a downloaded Playwright Chromium instead.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './ui',
  timeout: 45_000,
  // One worker: the admin login limit (5 failures in 15 minutes for each IP) and one shared session.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-ui' }]],
  use: {
    baseURL: process.env.UI_BASE_URL || process.env.API_BASE_URL || 'http://localhost:3400',
    headless: true,
  },
  // UI_BROWSERS=chrome,firefox,webkit runs the suite in each browser (default: chrome only). Firefox and WebKit
  // need `npx playwright install firefox webkit`, or PW_FIREFOX_PATH / PW_WEBKIT_PATH to an installed build.
  projects: (process.env.UI_BROWSERS || 'chrome').split(',').map((name) => name.trim()).map((name) => {
    if (name === 'firefox') return { name, use: { browserName: 'firefox', launchOptions: { executablePath: process.env.PW_FIREFOX_PATH || undefined } } };
    if (name === 'webkit') return { name, use: { browserName: 'webkit', launchOptions: { executablePath: process.env.PW_WEBKIT_PATH || undefined } } };
    return { name: 'chrome', use: { browserName: 'chromium', channel: process.env.PW_CHANNEL === undefined ? 'chrome' : process.env.PW_CHANNEL || undefined } };
  }),
});
