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
  await page.getByRole('textbox', { name: '创作输入' }).fill('极简风格白色夹克商品图');
  await page.getByRole('button', { name: '发送创作请求' }).click();
  await expect(page.getByRole('article', { name: '图片生成结果' })).toBeVisible();
  await expect(page.getByText('已完成')).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByText('极简风格白色夹克商品图')).toBeVisible();
  await expect(page.getByRole('button', { name: '批量下载' })).toBeVisible();
});

test('keeps the image composer usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto('/');
  await page.getByRole('button', { name: '创建图片' }).click();

  await expect(page.getByRole('button', { name: '添加参考图' })).toBeVisible();
  await page.getByLabel('上传参考图').setInputFiles({
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
    mimeType: 'image/png',
    name: 'mobile.png',
  });
  await expect(page.getByRole('button', { name: '移除 mobile.png' })).toBeVisible();
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

test('opens skill, model and parameter popovers on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.goto('/');
  await page.getByRole('button', { name: /白底图/ }).click();
  await expect(page.getByRole('dialog', { name: '技能配置' })).toBeVisible();
  await page.keyboard.press('Escape');

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


test('keeps public skill pages scrollable on small screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/skills');
  await page.mouse.wheel(0, 1800);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await expect(page.getByRole('link', { name: '了解种草图 →' })).toBeInViewport();
});

test('editing a Skill plan does not append the user request on every keystroke', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /白底图：/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '创作输入' }).fill('秋季新品');
  const plan = page.getByRole('textbox', { name: '发送前 Skill 方案' });
  await plan.fill('白底商品图');
  await plan.press('End');
  await plan.pressSequentially(' test');
  await expect(plan).toHaveValue('白底商品图 test');
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
    await page.getByRole('textbox', { name: '创作输入' }).fill(`批量验收 ${count} 张`);
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
  await page.getByRole('textbox', { name: '创作输入' }).fill('部分成功与重试验收');
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

test('shows all official skill details and sends unauthenticated accounts to login', async ({ page }) => {
  for (const name of ['白底图', '模特图', '种草图']) {
    await page.goto('/skills');
    await page.getByRole('link', { name: `了解${name} →` }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await expect(page.getByRole('heading', { name: '登录', exact: true })).toBeVisible();
});

test('launches a skill in a new session from its public detail page', async ({ page }) => {
  await page.goto('/skills');
  await page.getByRole('link', { name: '了解白底图 →' }).click();
  await page.getByRole('link', { name: '立即使用' }).click();
  await expect(page.getByRole('region', { name: '当前 Skill 方案' })).toContainText('白底图');
  await expect(page.getByRole('button', { name: '创建图片' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).not.toHaveURL(/skill=/);
});

test('preserves image settings after the first submission without an existing session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.goto('/');
  await page.getByRole('button', { name: '删除 欢迎使用 ZImage', exact: true }).click();
  await expect(page.getByRole('button', { name: '欢迎使用 ZImage', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '创建图片' }).click();
  await page.getByRole('button', { name: /^图片设置/ }).click();
  await page.getByRole('button', { name: '生成数量 1', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '创作输入' }).fill('第一张测试商品图');
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
  await page.getByRole('textbox', { name: '创作输入' }).fill('下载验收');
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
