import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
});

test('keeps two intentional identical chat turns distinct without duplicating either after reload', async ({ page }) => {
  const composer = page.getByRole('textbox', { name: '创作输入' });
  const timeline = page.getByLabel('对话时间线');
  for (let count = 1; count <= 2; count += 1) {
    await composer.fill('重复文本回归：解释陶瓷杯的构图');
    await page.getByRole('button', { name: '发送创作请求' }).click();
    await expect(timeline.getByText(/建议突出主体材质/)).toHaveCount(count);
    await expect(timeline.getByText('重复文本回归：解释陶瓷杯的构图', { exact: true })).toHaveCount(count);
    await expect(composer).toHaveValue('');
    // Text becomes visible before the final event; reloading at that point
    // cancels the request instead of exercising restoration of a completed turn.
    await expect(page.getByTestId('chat-stream-cursor')).toHaveCount(0);
  }
  await page.reload();
  await expect(timeline.getByText('重复文本回归：解释陶瓷杯的构图', { exact: true })).toHaveCount(2);
  await expect(timeline.getByText(/建议突出主体材质/)).toHaveCount(2);
  await expect(timeline.getByText(/服务暂时不可用|回复中断/)).toHaveCount(0);
});

test('recovers one chat failure without overwriting a draft and restores editing after reload', async ({ page }, testInfo) => {
  await page.getByRole('combobox').click();
  await page.getByText('Mock · 服务不可用', { exact: true }).click();
  const composer = page.getByRole('textbox', { name: '创作输入' });
  await composer.fill('解释陶瓷杯的构图');
  await page.getByRole('button', { name: '发送创作请求' }).click();
  await expect(page.getByText('聊天服务暂时不可用，请稍后重试。', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^重\s*试$/ })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('single-failure.png') });
  await page.getByRole('combobox').click();
  await page.getByText('Mock · 正常', { exact: true }).click();
  await composer.fill('新的未发送内容');
  await page.getByRole('button', { name: /^重\s*试$/ }).click();
  await expect(page.getByText(/建议突出主体材质/)).toBeVisible();
  await expect(composer).toHaveValue('新的未发送内容');
  await expect(page.getByRole('button', { name: '发送创作请求' })).toBeEnabled();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('retry-preserves-draft.png') });
  await page.reload();
  await composer.fill('保留这份新草稿');
  await page.getByRole('button', { name: '重新编辑', exact: true }).click();
  await expect(composer).toHaveValue('保留这份新草稿');
  await composer.fill('');
  await page.getByRole('button', { name: '重新编辑', exact: true }).click();
  await expect(composer).toHaveValue('解释陶瓷杯的构图');
  await expect(composer).toBeFocused();
});

test('updates displayed quota after recreating an image without reloading', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '创建图片' }).click();
  await page.getByRole('button', { name: /^图片设置/ }).click();
  await page.getByRole('button', { name: '生成数量 1', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: '创作输入' }).fill('额度回归图');
  await page.getByRole('button', { name: '发送创作请求' }).click();
  await expect(page.getByRole('article', { name: '图片生成结果' }).getByText('已完成', { exact: true })).toBeVisible();
  await expect(page.getByText('✦ 29 张', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重新生成第 1 张' }).click();
  await expect(page.getByRole('article', { name: '图片生成结果' })).toHaveCount(2);
  await expect(page.getByText('✦ 28 张', { exact: true })).toBeVisible();
  await expect(page.getByText('已完成', { exact: true })).toHaveCount(2);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('recreate-quota.png') });
});
