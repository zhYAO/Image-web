import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('renders the localized engineering foundation without serious accessibility violations', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Zima 工程基线' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  expect(accessibility.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
});

