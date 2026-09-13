import { expect, test } from '@playwright/test';

test('poster template persists, optimizes one field, generates without a product and remains classified after reload', async ({ page }, testInfo) => {
  await page.goto('/create');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByRole('link', { name: '使用攻略清单模板' }).click();
  const wizard = page.getByRole('region', { name: '小红书海报向导' });
  await expect(wizard).toBeVisible();
  await expect(wizard.getByRole('img', { name: /攻略清单/ })).toBeVisible();
  await wizard.getByLabel('海报标题', { exact: true }).fill('桌面整理');
  await wizard.getByLabel('海报内容', { exact: true }).fill('分类书本\n收好文具\n留出空白');
  await wizard.getByRole('button', { name: 'AI 优化当前内容', exact: true }).first().click();
  await expect(wizard.getByLabel('海报标题', { exact: true })).toHaveValue('桌面整理。');
  await wizard.getByRole('button', { name: '撤销优化' }).click();
  await expect(wizard.getByLabel('海报标题', { exact: true })).toHaveValue('桌面整理');
  await expect(wizard.getByLabel('海报内容', { exact: true })).toHaveValue('分类书本\n收好文具\n留出空白');
  await wizard.getByRole('button', { name: '预览分图方案' }).click();
  await expect(wizard.getByLabel('第 1 张文案')).toHaveValue('桌面整理\n分类书本\n收好文具\n留出空白');
  await wizard.getByRole('button', { name: '保存方案，稍后生成' }).click();
  const task = page.getByTestId('commerce-task');
  await expect(task.getByRole('status').first()).toHaveText('待确认');
  await page.getByRole('group', { name: '会话分类' }).getByRole('button', { name: '电商生图', exact: true }).click();
  await expect(page.getByRole('region', { name: '会话列表' })).toContainText('电商生图');
  await page.screenshot({ path: testInfo.outputPath('poster-workbench.png'), fullPage: true });
  await task.getByRole('button', { name: '确认生成 1 张' }).click();
  await expect(task.getByRole('button', { name: '下载当前选图（1 张）' })).toBeEnabled();
  await page.reload();
  await expect(task.getByRole('button', { name: '下载当前选图（1 张）' })).toBeEnabled();
  await page.getByRole('group', { name: '会话分类' }).getByRole('button', { name: '电商生图', exact: true }).click();
  await expect(page.getByRole('region', { name: '会话列表' })).toContainText('电商生图');
});

test('six style previews load and a product poster still requires a product image', async ({ page }) => {
  await page.goto('/create');
  for (const name of ['清新种草', '杂志拼贴', '极简大字', '手绘知识卡', '攻略清单', '复古海报']) {
    const img = page.getByRole('img', { name: `${name} · 海报封面 · AI 风格示例`, exact: true });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await page.goto('/?scene=xhs-poster');
  const wizard = page.getByRole('region', { name: '小红书海报向导' });
  await wizard.getByLabel('海报内容类型').click();
  await page.getByText('商品种草', { exact: true }).click();
  await wizard.getByRole('button', { name: '预览分图方案' }).click();
  await expect(wizard.getByRole('alert')).toHaveText('请上传至少一张清晰的真实商品图。');
});

test('a three-card poster preserves copy, redoes one card and downloads all selections', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?scene=xhs-poster&template=xhs-sketch');
  const wizard = page.getByRole('region', { name: '小红书海报向导' });
  await wizard.getByLabel('海报标题', { exact: true }).fill('周末阅读');
  await wizard.getByLabel('海报内容', { exact: true }).fill('选一本书\n记下一句感想');
  await wizard.getByLabel('方案图片数量').click();
  await page.locator('.ant-select-item-option-content').filter({ hasText: /^3$/ }).click();
  await wizard.getByRole('button', { name: '预览分图方案' }).click();
  await wizard.getByRole('button', { name: '编辑第 2 张：内容卡片' }).click();
  await expect(wizard.getByLabel('第 2 张文案')).toHaveValue('选一本书');
  await wizard.getByRole('button', { name: '编辑第 3 张：内容卡片' }).click();
  await wizard.getByLabel('第 3 张文案').fill('写下喜欢的一句');
  await wizard.getByRole('button', { name: '保存方案，稍后生成' }).click();
  const task = page.getByTestId('commerce-task');
  await task.getByRole('button', { name: '确认生成 3 张' }).click();
  await expect(task.getByRole('button', { name: '下载当前选图（3 张）' })).toBeEnabled();
  const first = await task.getByLabel('第 1 张历史版本').inputValue();
  const third = await task.getByLabel('第 3 张历史版本').inputValue();
  await task.getByRole('button', { name: '修改第 3 张' }).click();
  const dialog = task.getByRole('dialog', { name: '修改分图方案' });
  await expect(dialog.getByLabel('第 3 张文案')).toHaveValue('写下喜欢的一句');
  await dialog.getByLabel('第 3 张要求').fill('增加标题留白');
  await dialog.getByRole('button', { name: '保存修改方案' }).click();
  await task.getByRole('button', { name: '确认生成 1 张' }).click();
  await expect(task.getByLabel('第 3 张历史版本')).not.toHaveValue(third);
  await expect(task.getByLabel('第 1 张历史版本')).toHaveValue(first);
  await task.getByLabel('第 3 张历史版本').selectOption(third);
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await task.getByRole('button', { name: '下载当前选图（3 张）' }).click();
  await expect.poll(() => downloads.length).toBe(3);
});
