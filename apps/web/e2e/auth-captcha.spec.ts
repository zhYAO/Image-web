import { expect, test } from '@playwright/test';

test('keeps the light CAPTCHA aligned and updates verification, expiry and retry feedback', async ({ page }, info) => {
  // Exercise our integration deterministically; this is not a real CAPTCHA solve.
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.turnstile = {
      render(container, options) {
        container.dataset.theme = options.theme;
        container.dataset.size = options.size;
        for (const [label, callback] of [
          ['模拟验证通过', () => options.callback('test-token')],
          ['模拟验证过期', () => options['expired-callback']()],
          ['模拟验证失败', () => options['error-callback']()]
        ]) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = label;
          button.addEventListener('click', callback); container.appendChild(button);
        }
        return 'test-widget';
      },
      remove() {}
    };`,
  }));
  await page.goto('/login');
  const captcha = page.getByLabel('安全验证', { exact: true });
  test.skip(await captcha.count() === 0, 'This build has no Turnstile site key configured.');
  const submit = page.locator('form button[type="submit"]');
  await expect(submit).toBeDisabled();
  await expect(captcha.locator('[data-theme="light"][data-size="flexible"]')).toHaveCount(1);
  await captcha.getByRole('button', { name: '模拟验证通过' }).click();
  await expect(captcha.getByRole('status')).toHaveText('安全验证已通过');
  await expect(submit).toBeEnabled();
  await captcha.getByRole('button', { name: '模拟验证过期' }).click();
  await expect(captcha.getByRole('alert')).toContainText('已过期');
  await expect(submit).toBeDisabled();
  await page.screenshot({ path: info.outputPath('captcha-expired.png'), animations: 'disabled' });
  await captcha.getByRole('button', { name: '重新验证' }).click();
  await expect(captcha.getByRole('status')).toHaveText('请完成安全验证后提交。');
  await captcha.getByRole('button', { name: '模拟验证失败' }).click();
  await expect(captcha.getByRole('alert')).toContainText('未完成');
  await captcha.getByRole('button', { name: '重新验证' }).click();
  await captcha.getByRole('button', { name: '模拟验证通过' }).click();
  await expect(submit).toBeEnabled();
  const box = await captcha.boundingBox();
  const emailBox = await page.getByLabel('邮箱').boundingBox();
  expect(Math.abs(box!.width - emailBox!.width)).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath('captcha-success.png'), animations: 'disabled' });
});
