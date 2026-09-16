import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const baseURL = new URL(process.env.REAL_ACCEPTANCE_BASE_URL ?? 'http://localhost:3000');
if (baseURL.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(baseURL.hostname)) {
  throw new Error('Real acceptance requires HTTPS except for loopback.');
}
const storageState = process.env.REAL_ACCEPTANCE_STORAGE_STATE;
if (!storageState || !fs.existsSync(storageState)) {
  throw new Error('Provide REAL_ACCEPTANCE_STORAGE_STATE from a signed-in dedicated test account. Never commit this credential file.');
}

export default defineConfig({
  testDir: './e2e-real',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  outputDir: '../../.design-qa/2026-09-16-real-acceptance/playwright-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../.design-qa/2026-09-16-real-acceptance/playwright-report' }]],
  projects: [{ name: 'real-desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  use: { baseURL: baseURL.origin, storageState, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
