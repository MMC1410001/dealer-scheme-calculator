// API-only suite: no browsers are launched (request contexts only). See qa/README.md.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  // Each worker gets one token, and the token endpoint allows TOKEN_RATE_LIMIT_PER_MINUTE (default 30) per IP.
  // 4 workers + the token-endpoint cases stay under 30. Change with PW_WORKERS.
  workers: Number(process.env.PW_WORKERS || 4),
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: process.env.API_BASE_URL || 'http://localhost:3400',
  },
});
