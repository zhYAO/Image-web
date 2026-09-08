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
  await page.getByRole('button', { name: '创建图片' }).click();
  await page.getByLabel('上传参考图').setInputFiles({
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
    mimeType: 'image/png',
    name: 'reference.png',
  });
  await expect(page.getByRole('img', { name: '参考图 reference.png' })).toBeVisible();
  await page.getByRole('textbox', { name: '创作输入' }).fill('生成极简风格白色夹克商品图');
  await page.getByRole('button', { name: '发送创作请求' }).click();
  await expect(page.getByRole('article', { name: '图片生成结果' })).toBeVisible();
  await expect(page.getByText('已完成')).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByText('生成极简风格白色夹克商品图')).toBeVisible();
  await expect(page.getByRole('button', { name: '批量下载' })).toBeVisible();
});

test('keeps the image composer usable on desktop', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '创建图片' }).click();

  await expect(page.getByRole('button', { name: '添加参考图' })).toBeVisible();
  await page.getByLabel('上传参考图').setInputFiles({
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
    mimeType: 'image/png',
    name: 'desktop.png',
  });
  await expect(page.getByRole('button', { name: '移除 desktop.png' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '创作输入' })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送创作请求' })).toBeVisible();
  await expect(page.getByRole('button', { name: '资产库' }).locator('svg')).toBeVisible();
  await expect(page.getByRole('switch', { name: '图片工具' })).toHaveCount(0);
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

test('opens image parameters without exposing legacy skills', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.goto('/');
  await expect(page.getByRole('button', { name: '选择技能' })).toHaveCount(0);
  await page.getByRole('button', { name: '创建图片' }).click();

  await page.getByRole('button', { name: /^图片设置/ }).click();
  await expect(page.getByRole('dialog', { name: '图片生成设置' })).toContainText('服务正常');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^图片设置/ }).click();
  await expect(page.getByRole('dialog', { name: '图片生成设置' })).toBeVisible();
  await expect(page.getByRole('button', { name: '比例 16:9' })).toBeVisible();
  await expect(page).toHaveScreenshot('parameters-open.png', { fullPage: true });
});

test('keeps chat and image provider selections independent on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.goto('/');
  await page.getByRole('button', { name: '聊天模型 豆包' }).click();
  await expect(page.getByRole('dialog', { name: '聊天模型' })).toContainText('MiniMax');
  await page.getByRole('button', { name: 'minimax · MiniMax' }).click();
  await expect(page.getByRole('button', { name: '聊天模型 MiniMax' })).toBeVisible();

  await page.getByRole('button', { name: '创建图片' }).click();
  await expect(page.getByRole('button', { name: /^图片设置 gemini Gemini 3 Pro Image/ })).toBeVisible();
  await page.getByRole('button', { name: '创建图片' }).click();
  await expect(page.getByRole('button', { name: '聊天模型 MiniMax' })).toBeVisible();
});


test('keeps the commerce catalogue scrollable after a legacy redirect', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/skills');
  await page.mouse.wheel(0, 1800);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await expect(page).toHaveURL('/create');
  await expect(page.getByRole('link', { name: '开始种草图文 →' })).toBeVisible();
});

test('editing an ecommerce draft does not append the user request on every keystroke', async ({ page }) => {
  await page.goto('/?scene=product-main');
  const name=page.getByRole('textbox', { name: '商品名称' });
  await name.fill('秋季新品');
  await name.press('End');
  await name.pressSequentially(' test');
  await expect(name).toHaveValue('秋季新品 test');
  await expect(page.getByRole('article', {name:'图片生成结果'})).toHaveCount(0);
});

for (const count of [1, 2, 3, 4]) {
  test(`generates exactly ${count} images with the selected settings`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop');
    await page.goto('/');
    await page.getByRole('button', { name: '创建图片' }).click();
    await page.getByRole('button', { name: /^图片设置/ }).click();
    await page.getByRole('button', { name: `生成数量 ${count}`, exact: true }).click();
    await page.getByRole('button', { name: '比例 16:9' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('textbox', { name: '创作输入' }).fill(`生成批量验收 ${count} 张`);
    await page.getByRole('button', { name: '发送创作请求' }).click();
    const result = page.getByRole('article', { name: '图片生成结果' });
    await expect(result.getByText('已完成', { exact: true })).toBeVisible();
    await expect(result.getByRole('img', { name: /^生成结果/ })).toHaveCount(count);
    await expect(result).toContainText('16:9');
    await expect(page.getByRole('button', { name: '创建图片' })).toHaveAttribute('aria-pressed', 'true');
    await result.getByRole('img', { name: '生成结果 1', exact: true }).click();
    await expect(page.getByRole('button', { name: 'close', exact: true })).toBeFocused();
    await expect(page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'zoomIn' }) })).toHaveCSS('opacity', '1');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'zoomIn' })).not.toBeVisible();
  });
}

test('creates, renames and deletes only the selected test session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.goto('/');
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await page.getByRole('button', { name: '重命名 新的创作', exact: true }).last().click();
  await page.getByRole('textbox', { name: '会话名称' }).fill('会话管理验收');
  await page.getByRole('button', { name: '保存会话名称' }).click();
  await expect(page.getByRole('button', { name: '会话管理验收', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除 会话管理验收', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '会话管理验收', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '会话管理验收', exact: true })).toHaveCount(0);
});

test('keeps a failed image retry inside the unified history', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Mock 场景' }).click();
  await page.getByText('Mock · 部分成功', { exact: true }).click();
  await page.getByRole('button', { name: '创建图片' }).click();
  await page.getByRole('textbox', { name: '创作输入' }).fill('生成部分成功与重试验收');
  await page.getByRole('button', { name: '发送创作请求' }).click();
  await expect(page.getByText('部分成功', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试失败项' }).click();
  await expect(page.getByRole('article', { name: '图片生成结果' })).toHaveCount(2);
});

test('validates reference formats and restores references when toggling creation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '创建图片' }).click();
  await page.getByLabel('上传参考图').setInputFiles({ name: 'unsupported.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('alert').filter({ hasText: '格式不支持' })).toBeVisible();
  await page.getByLabel('上传参考图').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
  await page.getByRole('button', { name: '创建图片' }).click();
  await expect(page.getByRole('img', { name: '参考图 reference.png' })).toHaveCount(0);
  await page.getByRole('button', { name: '创建图片' }).click();
  await expect(page.getByRole('img', { name: '参考图 reference.png' })).toBeVisible();
  await page.getByRole('button', { name: '移除 reference.png' }).click();
  await expect(page.getByRole('img', { name: '参考图 reference.png' })).toHaveCount(0);
});

test('supports newline, empty-input protection and keyboard submit', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '创作输入' });
  const send = page.getByRole('button', { name: '发送创作请求' });
  await input.fill('   ');
  await expect(send).toBeDisabled();
  await input.fill('第一行');
  await input.press('Shift+Enter');
  await input.pressSequentially('second line');
  await expect(input).toHaveValue('第一行\nsecond line');
  await input.press('Enter');
  await expect(page.getByText(/建议突出主体材质/)).toBeVisible();
  await expect(input).toHaveValue('');
});

test('redirects retired Skill pages to commerce without starting a task', async ({ page }) => {
  for (const path of ['/skills', '/skills/white-background', '/skills/model', '/skills/social']) {
    await page.goto(path);
    await expect(page).toHaveURL('/create');
    await expect(page.getByRole('heading', { name: '让商品成为画面主角' })).toBeVisible();
    await expect(page.getByRole('link', { name: '官方 Skill' })).toHaveCount(0);
  }
});

test('sends unauthenticated accounts to login with a reachable auth backend', async ({ page }) => {
  test.skip(process.env.PHASE2_AUTH_E2E !== 'true', 'Requires a configured, reachable Supabase Auth backend; mock mode does not emulate server auth.');
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible();
});

test('starts commerce only from an explicit scene selection', async ({ page }) => {
  await page.goto('/create');
  await page.getByRole('link', { name: '开始商品主图 →' }).click();
  await expect(page.getByRole('region', { name: '商品主图向导' })).toContainText('商品主图');
  await expect(page).not.toHaveURL(/scene=/);
});

test('ordinary image creation ignores retired skill links and never opens a commerce wizard', async ({ page }) => {
  await page.goto('/?skill=white-background&new=1');
  await page.getByRole('button', { name: '创建图片' }).click();
  await page.getByRole('textbox', { name: '创作输入' }).fill('生成一张月球风景图');
  await page.getByRole('button', { name: '发送创作请求' }).click();
  await expect(page.getByRole('article', { name: '图片生成结果' }).getByText('已完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: /向导/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '你好，想创作什么？' })).toHaveCount(0);
});

test('preserves image settings after the first submission without an existing session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.goto('/');
  await page.getByRole('button', { name: '删除 欢迎使用 ZImage', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '欢迎使用 ZImage', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '创建图片' }).click();
  await page.getByRole('button', { name: /^图片设置/ }).click();
  await page.getByRole('button', { name: '生成数量 1', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '创作输入' }).fill('生成第一张测试商品图');
  await page.getByRole('button', { name: '发送创作请求' }).click();
  await expect(page.getByRole('article', { name: '图片生成结果' }).getByText('已完成')).toBeVisible();
  await expect(page.getByRole('button', { name: '创建图片' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^图片设置.*1张$/ })).toBeVisible();
});

test('downloads a cross-origin image without leaving the workspace', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.route('https://storage.example/qa.png', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: '创建图片' }).click();
  await page.getByRole('button', { name: /^图片设置/ }).click();
  await page.getByRole('button', { name: '生成数量 1', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '创作输入' }).fill('生成下载验收图');
  await page.getByRole('button', { name: '发送创作请求' }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const raw = localStorage.getItem('zimage:mock:v1')!;
    const state = JSON.parse(raw, (key, value) => key === 'url' && typeof value === 'string' && value.startsWith('data:image/') ? 'https://storage.example/qa.png' : value);
    localStorage.setItem('zimage:mock:v1', JSON.stringify(state));
  });
  await page.reload();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '批量下载' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^zimage-.+-1\.png$/);
  expect(await download.failure()).toBeNull();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('已发起 1 张图片下载。')).toBeVisible();
});
