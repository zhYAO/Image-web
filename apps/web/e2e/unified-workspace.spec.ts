import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
});

test('starts a streaming chat from the unified home', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '你好，想创作什么？' })).toBeVisible();
  await page.getByRole('textbox', { name: '创作输入' }).fill('帮我完善一段商品图提示词');
  await page.getByRole('button', { name: '发送创作请求' }).click();
  await expect(page.getByRole('article').filter({ hasText: '帮我完善一段商品图提示词' })).toBeVisible();
  await expect(page.getByText(/建议突出主体材质/)).toBeVisible({ timeout: 10_000 });
});

test('queues 1-4 images and restores the timeline after refresh', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '生图模式' }).click();
  await page.getByLabel('上传参考图').setInputFiles({
    buffer: Buffer.from('reference-image'),
    mimeType: 'image/png',
    name: 'reference.png',
  });
  await expect(page.getByRole('img', { name: '参考图 reference.png' })).toBeVisible();
  await page.getByRole('textbox', { name: '创作输入' }).fill('极简风格白色夹克商品图');
  await page.getByRole('button', { name: '发送创作请求' }).click();
  await expect(page.getByText('排队中')).toBeVisible();
  await expect(page.getByText('已完成')).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByText('极简风格白色夹克商品图')).toBeVisible();
  await expect(page.getByRole('button', { name: '批量下载' })).toBeVisible();
});

test('keeps the image composer usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto('/');
  await page.getByRole('button', { name: '生图模式' }).click();

  await expect(page.getByRole('button', { name: '添加参考图' })).toBeVisible();
  await page.getByLabel('上传参考图').setInputFiles({
    buffer: Buffer.from('mobile-reference'),
    mimeType: 'image/webp',
    name: 'mobile.webp',
  });
  await expect(page.getByRole('button', { name: '移除 mobile.webp' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '创作输入' })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送创作请求' })).toBeVisible();
  await expect(page.getByRole('switch', { name: '图片工具' })).toBeChecked();
  await expect(page.getByRole('switch', { name: '图片工具' })).toBeDisabled();
});

test('redirects legacy routes to the unified home', async ({ page }) => {
  await page.goto('/chat');
  await expect(page).toHaveURL('/');
  await page.goto('/image');
  await expect(page).toHaveURL('/');
});

test('matches the desktop empty workspace', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '你好，想创作什么？' })).toBeVisible();
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
  await expect(page).toHaveScreenshot('empty.png', { fullPage: true });
});

test('opens skill, model and parameter popovers on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.goto('/');
  await page.getByRole('button', { name: /白底图/ }).click();
  await expect(page.getByRole('dialog', { name: '技能配置' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /生成模型/ }).click();
  await expect(page.getByRole('dialog', { name: '选择生成模型' })).toContainText('服务正常');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '生成参数 1:1 2K 2张' }).click();
  await expect(page.getByRole('dialog', { name: '生成参数' })).toBeVisible();
  await expect(page.getByRole('button', { name: '比例 16:9' })).toBeVisible();
  await expect(page).toHaveScreenshot('parameters-open.png', { fullPage: true });
});
