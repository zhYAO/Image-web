import { expect, test } from '@playwright/test';

// Read-only smoke tests. Paid UI journeys use the persistent budget CLI and
// operator-reviewed cases; this suite never calls a model or a cleanup worker.
test.beforeEach(async ({ page, request }) => {
  const account = await request.get('/api/account');
  expect(account.status(), 'A real verified test account must be signed in').toBe(200);
  const identity = await account.json();
  expect(identity.status).toBe('active');
  expect(identity.id).toMatch(/^[0-9a-f-]{36}$/i);
  await page.route('**/api/**', async route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
});

test('real wallet, prices and ledger are available under the signed-in identity', async ({ request, page }, info) => {
  for (const endpoint of ['/api/credits', '/api/credits/pricing', '/api/credits/ledger', '/api/sessions', '/api/quotas']) {
    const response = await request.get(endpoint);
    expect(response.status(), endpoint).toBe(200);
  }
  const wallet = await (await request.get('/api/credits')).json();
  for (const key of ['availableMinor', 'frozenMinor', 'spentMinor']) {
    expect(Number.isSafeInteger(wallet[key])).toBe(true);
    expect(wallet[key]).toBeGreaterThanOrEqual(0);
  }
  const catalog = await (await request.get('/api/credits/pricing')).json();
  expect(catalog.enabled).toBe(true);
  expect(catalog.prices).toEqual(expect.arrayContaining([expect.objectContaining({ provider: 'seedream', resolution: '2K' })]));
  await page.goto('/account');
  await expect(page.getByRole('region', { name: '积分账户' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('account.png'), fullPage: true });
});

test('all seven real catalogue entries and eighteen previews are available at desktop widths', async ({ page }, info) => {
  test.setTimeout(180_000);
  const scenes = ['商品主图', '商品套图', '详情图', '种草图文', '参考风格', '模特图', '小红书海报'];
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/create');
    await expect(page.getByRole('heading', { name: '选择生图类型', exact: true })).toBeVisible();
    for (const scene of scenes) await expect(page.getByRole('link', { name: `开始${scene} →`, exact: true })).toBeVisible();
    const covers = page.locator('article img');
    const previews = page.locator('details .ant-image-img');
    await expect(covers).toHaveCount(7);
    await expect(previews).toHaveCount(18);
    for (const img of await covers.or(previews).all()) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      await expect(img).toHaveCSS('object-fit', 'contain');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`catalogue-${width}.png`), fullPage: true });
  }
});

test('workspace remains real, authenticated and intact after reload', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('log', { name: '对话时间线' })).toBeVisible();
  await expect(page.getByText(/模拟预览.*不调用真实模型/)).toHaveCount(0);
  await page.getByRole('button', { name: '查看积分与模型价格' }).click();
  await expect(page.getByRole('dialog')).toContainText('Seedream');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('log', { name: '对话时间线' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('workspace.png') });
});

test('signed-out clients cannot read test-account resources', async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    for (const endpoint of ['/api/account', '/api/credits', '/api/credits/ledger', '/api/sessions']) {
      const response = await anonymous.get(endpoint);
      expect(response.status(), endpoint).toBe(401);
    }
  } finally { await anonymous.dispose(); }
});
