const { defineConfig, devices } = require('@playwright/test');
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:18083';

module.exports = defineConfig({
  testDir: './tests/browser',
  timeout: 120000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  // Rendering specs include wall-clock latency/deadline assertions.
  // Avoid unrelated test files competing for the same browser/GPU resources.
  workers: 1,
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'node server.js',
    url: `${baseURL}/en`,
    env: { PORT: '18083' },
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'tests/reports/playwright-html', open: 'never' }],
    ['json', { outputFile: 'tests/reports/playwright-results.json' }],
  ],
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
