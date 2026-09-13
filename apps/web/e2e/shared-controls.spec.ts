import { expect, test } from '@playwright/test';

function contrast(a: number[], b: number[]) {
  const luminance = (rgb: number[]) => rgb.reduce((sum, value, index) => {
    const c = value / 255;
    return sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!;
  }, 0);
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + .05) / (values[1]! + .05);
}

test('enabled composer placeholder stays readable on its darkest possible glass background', async ({ page }, testInfo) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '创作输入' });
  await expect(input).toBeEnabled();
  const sample = await input.evaluate((element) => {
    const placeholder = getComputedStyle(element, '::placeholder');
    const shell = element.parentElement!.parentElement!;
    return { color: placeholder.color, opacity: placeholder.opacity, background: getComputedStyle(shell).backgroundColor };
  });
  await page.screenshot({ path: testInfo.outputPath('placeholder.png'), animations: 'disabled' });
  const foreground = sample.color.match(/[\d.]+/g)!.map(Number).slice(0, 3);
  // The near-opaque white shell is tested over black, a stricter backdrop than
  // the current pale gradient or any image visible behind the input dock.
  const surface = sample.background.match(/[\d.]+/g)!.map(Number);
  expect(surface.slice(0, 3)).toEqual([255, 255, 255]);
  const alpha = surface[3] ?? 1;
  expect(sample.opacity).toBe('1');
  const ratio = contrast(foreground, [255 * alpha, 255 * alpha, 255 * alpha]);
  await testInfo.attach('contrast', { body: JSON.stringify({ ...sample, ratio }), contentType: 'application/json' });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('shared controls expose keyboard focus and keep disabled actions distinct', async ({ page }, testInfo) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: '创作输入' });
  const send = page.getByRole('button', { name: '发送创作请求' });
  await expect(send).toBeDisabled();
  const disabledBackground = await send.evaluate((el) => getComputedStyle(el).backgroundColor);
  await send.hover();
  expect(await send.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(disabledBackground);
  await composer.focus();
  await page.keyboard.press('Tab');
  const create = page.getByRole('button', { name: '创建图片' });
  await expect(create).toBeFocused();
  const ring = await create.evaluate((el) => {
    const css = getComputedStyle(el);
    return { color: css.outlineColor, width: css.outlineWidth, style: css.outlineStyle };
  });
  expect(ring).toEqual({ color: 'rgb(0, 102, 204)', width: '3px', style: 'solid' });
  await page.screenshot({ path: testInfo.outputPath('keyboard-focus.png'), animations: 'disabled' });
  await page.keyboard.press('Enter');
  const settings = page.getByRole('button', { name: /^图片设置/ });
  await settings.click();
  await expect(page.getByRole('dialog', { name: '图片生成设置' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeFocused();
  const scenario = page.getByRole('combobox', { name: 'Mock 场景' });
  await page.keyboard.press('Tab');
  await scenario.focus();
  // AntD transitions the outline; await the final visible state, not an intermediate color.
  await expect.poll(() => scenario.evaluate((el) => {
    const css = getComputedStyle(el.closest('.ant-select')!);
    return { color: css.outlineColor, style: css.outlineStyle, width: css.outlineWidth };
  })).toEqual({ color: 'rgb(0, 102, 204)', style: 'solid', width: '3px' });
  await composer.fill('共享状态检查');
  await expect(send).toBeEnabled();
});

test('reduced transparency uses opaque surfaces and reduced motion suppresses arrival effects', async ({ page }, testInfo) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-reduced-transparency', value: 'reduce' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ] });
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: '创作输入' });
  await expect(composer).toBeVisible();
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(true);
  const css = await composer.evaluate((el) => {
    const shell = getComputedStyle(el.parentElement!.parentElement!);
    return { background: shell.backgroundColor, filter: shell.backdropFilter };
  });
  expect(css).toEqual({ background: 'rgb(255, 255, 255)', filter: 'none' });
  await page.getByRole('button', { name: '创建图片' }).click();
  await page.getByRole('button', { name: /^图片设置/ }).click();
  const dialog = page.getByRole('dialog', { name: '图片生成设置' });
  await expect(dialog).toBeVisible();
  const surface = await dialog.evaluate((el) => {
    const css = getComputedStyle(el);
    return { background: css.backgroundColor, filter: css.backdropFilter, duration: parseFloat(css.animationDuration) };
  });
  expect(surface.background).toBe('rgb(255, 255, 255)');
  expect(surface.filter).toBe('none');
  expect(surface.duration).toBeLessThanOrEqual(.001);
  await page.screenshot({ path: testInfo.outputPath('solid-reduced-motion.png'), animations: 'disabled' });
});
