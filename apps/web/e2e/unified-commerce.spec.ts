import { expect, test } from '@playwright/test';

const scenes = [
  ['商品主图', 'product-main'], ['商品套图', 'product-set'], ['详情图', 'detail'],
  ['种草图文', 'social'], ['参考风格', 'style-reference'], ['模特图', 'model'],
  ['小红书海报', 'xhs-poster'],
] as const;

test('one commerce entry leads to all seven creation types', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.getByRole('link', { name: '小红书海报', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '会话分类' }).getByRole('button')).toHaveText(['全部', '聊天', '普通生图', '电商生图']);
  await page.getByRole('complementary').getByRole('link', { name: '电商生图', exact: true }).click();
  await expect(page.getByRole('heading', { name: '选择生图类型', exact: true })).toBeVisible();
  for (const [name, scene] of scenes) {
    await page.goto('/create');
    const launch = page.getByRole('link', { name: `开始${name} →`, exact: true });
    await expect(launch).toHaveAttribute('href', `/?scene=${scene}${scene === 'xhs-poster' ? '&platform=xiaohongshu' : ''}`);
    await launch.click();
    const wizard = page.getByRole('region', { name: `${name}向导` });
    await expect(wizard).toBeVisible();
    if (scene === 'xhs-poster') {
      await expect(wizard.locator('.ant-select').filter({ has: page.getByLabel('创作平台') })).toContainText('小红书');
    }
  }
});

test('womenswear covers and all template previews load uncropped at desktop widths', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/create');
    const covers = page.locator('article img');
    await expect(covers).toHaveCount(7);
    for (const cover of await covers.all()) {
      await cover.scrollIntoViewIfNeeded();
      await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      await expect(cover).toHaveCSS('object-fit', 'contain');
      expect(await cover.getAttribute('src')).toContain('womenswear');
    }
    const previews = page.locator('details .ant-image-img');
    await expect(previews).toHaveCount(18);
    for (const preview of await previews.all()) {
      await preview.scrollIntoViewIfNeeded();
      await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      await expect(preview).toHaveCSS('object-fit', 'contain');
      await expect(preview).toHaveAttribute('src', /-womenswear-v1.webp$/);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`catalogue-${width}.png`), fullPage: true });
  }
  await page.locator('details .ant-image-img').last().click();
  await expect(page.locator('.ant-image-preview-img')).toBeVisible();
  await expect(page.locator('.ant-image-preview-img')).toHaveAttribute('src', /xhs-retro-womenswear-v1.webp$/);
  await page.screenshot({ path: testInfo.outputPath('enlarged-preview.png') });
});

test('womenswear previews do not enter a different product plan', async ({ page }) => {
  await page.goto('/create');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/?scene=product-main');
  const wizard = page.getByRole('region', { name: '商品主图向导' });
  await wizard.getByLabel('上传电商参考图').setInputFiles({
    name: 'cup.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
  });
  await wizard.getByLabel('商品名称', { exact: true }).fill('白色陶瓷杯');
  await wizard.getByRole('button', { name: '预览分图方案' }).click();
  await wizard.getByRole('button', { name: '保存方案，稍后生成' }).click();
  await expect(page.getByTestId('commerce-task')).toBeVisible();
  const persisted = await page.evaluate(() => localStorage.getItem('zimage:mock:v1'));
  expect(persisted).toContain('白色陶瓷杯');
  expect(persisted).not.toMatch(/womenswear|米杏|衬衫|双胸袋|松弛感/);
});

test('workbench numbering stays outside the full womenswear preview', async ({ page }, testInfo) => {
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/?scene=xhs-poster&template=xhs-fresh');
    const preview = page.getByRole('img', { name: '清新种草 · 海报封面 · AI 风格示例', exact: true });
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(preview).toHaveCSS('object-fit', 'contain');
    const badge = page.locator('[class*="structureNumber"]').first();
    await expect.poll(async () => {
      const imageBox = await preview.boundingBox();
      const badgeBox = await badge.boundingBox();
      return !!imageBox && !!badgeBox && badgeBox.y + badgeBox.height <= imageBox.y;
    }).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`poster-preview-${width}.png`) });
  }
});
