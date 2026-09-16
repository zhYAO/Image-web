import { expect, test } from '@playwright/test';

test('keeps reference bytes across reload, isolates sessions and persists removal', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByRole('button', { name: '重命名 欢迎使用 ZImage', exact: true }).click();
  await page.getByRole('textbox', { name: '会话名称' }).fill('附件恢复测试会话');
  await page.getByRole('button', { name: '保存会话名称' }).click();
  await page.getByRole('textbox', { name: '创作输入' }).fill('附件恢复测试会话');
  await page.getByRole('button', { name: '发送创作请求' }).click();
  await expect(page.getByText(/建议突出主体材质/)).toBeVisible();
  await page.getByRole('button', { name: '创建图片' }).click();
  await page.getByLabel('上传参考图').setInputFiles({
    name: 'restore.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(page.getByRole('img', { name: '参考图 restore.png' })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('zimage-composer-attachments-v1');
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise<number>((resolve) => {
        const request = db.transaction('drafts').objectStore('drafts').count();
        request.onsuccess = () => resolve(request.result);
      });
    } finally { db.close(); }
  })).toBe(1);
  await page.reload();
  const image = page.getByRole('img', { name: '参考图 restore.png' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
  await page.getByRole('button', { name: '新对话', exact: true }).click();
  await expect(image).toHaveCount(0);
  await page.getByRole('button', { name: '附件恢复测试会话', exact: true }).click();
  await expect(image).toBeVisible();
  await page.getByRole('button', { name: '移除 restore.png' }).click();
  await expect(image).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '创作输入' })).toBeEnabled();
  await expect(image).toHaveCount(0);
});
