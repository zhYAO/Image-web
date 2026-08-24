import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PHASE1B_HTTP_BASE_URL?.trim();
if (!baseURL) {
  throw new Error('PHASE1B_HTTP_BASE_URL is required for the real HTTP acceptance suite.');
}

const parsedBaseURL = new URL(baseURL);
if (parsedBaseURL.protocol !== 'https:' && parsedBaseURL.hostname !== '127.0.0.1' && parsedBaseURL.hostname !== 'localhost') {
  throw new Error('PHASE1B_HTTP_BASE_URL must use HTTPS unless it targets localhost.');
}

export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: false,
  projects: [{
    name: 'phase1b-http-chromium',
    use: { ...devices['Desktop Chrome'], viewport: { height: 900, width: 1440 } },
  }],
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-http' }]],
  retries: process.env.CI ? 1 : 0,
  testDir: './e2e',
  testMatch: 'http-phase1b.spec.ts',
  use: {
    baseURL: parsedBaseURL.origin,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  workers: 1,
});
