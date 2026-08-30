import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.02 },
  },
  fullyParallel: true,
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { height: 900, width: 1440 } },
    },
    {
      name: 'edge-tablet',
      use: { browserName: 'chromium', channel: 'msedge', viewport: { height: 768, width: 1024 } },
    },
    {
      name: 'chromium-mobile',
      use: { browserName: 'chromium', viewport: { height: 844, width: 390 } },
    },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
  retries: process.env.CI ? 2 : 0,
  testDir: './e2e',
  testIgnore: 'http-phase1b.spec.ts',
  workers: 3,
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:3100',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: externalBaseUrl ? undefined : {
    command: 'pnpm dev --hostname 127.0.0.1 --port 3100',
    env: { NEXT_DIST_DIR: '.next-playwright', NEXT_PUBLIC_DATA_MODE: 'mock' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: 'http://127.0.0.1:3100',
  },
});
