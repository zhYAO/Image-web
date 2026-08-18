import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'cd apps/web && node node_modules/next/dist/bin/next dev',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: 'http://localhost:3000',
  },
  projects: [
    {
      name: 'chromium-wide',
      use: { ...devices['Desktop Chrome'], viewport: { height: 900, width: 1440 } },
    },
    {
      name: 'chromium-375',
      use: { ...devices['Desktop Chrome'], viewport: { height: 812, width: 375 } },
    },
  ],
});
