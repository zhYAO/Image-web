import { expect, test } from "@playwright/test";
import { COMMERCE_SCENES } from "@zimage/domain";

const product = {
  name: "product.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
};

for (const scene of COMMERCE_SCENES) {
  test(`${scene.name}: validates, previews, edits, saves and generates only after confirmation`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await page.goto(`/?scene=${scene.id}`);
    const wizard = page.getByRole("region", { name: `${scene.name}向导` });
    if (scene.id === "xhs-poster") {
      await wizard.getByLabel("海报内容类型").click();
      await page.getByText("商品种草", { exact: true }).click();
    }
    await wizard.getByRole("button", { name: "预览分图方案" }).click();
    await expect(wizard.getByRole("alert")).toContainText("请上传");
    await wizard.getByLabel("上传电商参考图").setInputFiles(product);
    await wizard.getByLabel("商品名称", { exact: true }).fill("暖白陶瓷杯");
    if (scene.id === "style-reference") {
      await wizard.getByRole("button", { name: "预览分图方案" }).click();
      await expect(wizard.getByRole("alert")).toContainText(
        "请添加一张风格参考图",
      );
      await wizard
        .getByLabel("上传电商参考图")
        .setInputFiles({ ...product, name: "style.png" });
      await wizard.getByLabel("参考图 2 用途").click();
      await page
        .locator(".ant-select-item-option-content")
        .filter({ hasText: /^风格参考图$/ })
        .click();
    }
    await wizard.getByRole("button", { name: "预览分图方案" }).click();
    await expect(page.getByTestId("commerce-task")).toHaveCount(0);
    await wizard.getByLabel("第 1 张文案").fill("每天一杯好心情");
    await wizard.getByLabel("商品名称", { exact: true }).fill("暖白陶瓷随行杯");
    await expect(wizard.getByRole("button", { name: /^确认生成/ })).toHaveCount(
      0,
    );
    await wizard.getByRole("button", { name: "预览分图方案" }).click();
    await expect(wizard.getByLabel("第 1 张文案")).toHaveValue(
      "每天一杯好心情",
    );
    if (scene.id === "product-set")
      await page.screenshot({
        path: info.outputPath("plan-editor.png"),
        animations: "disabled",
      });
    await wizard.getByRole("button", { name: "保存方案，稍后生成" }).click();
    const task = page.getByTestId("commerce-task");
    await expect(task.getByRole("status").first()).toHaveText("待确认");
    await page.reload();
    await expect(task.getByRole("status").first()).toHaveText("待确认");
    await task
      .getByRole("button", { name: `确认生成 ${scene.count} 张` })
      .dblclick();
    await expect(
      task.getByRole("button", { name: `下载当前选图（${scene.count} 张）` }),
    ).toBeEnabled();
    await expect(
      task.getByLabel("第 1 张历史版本").locator('option:not([value=""])'),
    ).toHaveCount(1);
    if (scene.id === "product-set") {
      await task.getByRole("heading").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("plan-results.png"), animations: "disabled" });
    }
  });
}

for (const width of [1280, 1440, 1920]) {
  test(`desktop ${width}: independent scrolling and unobscured primary action`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?scene=product-set");
    const wizard = page.getByRole("region", { name: "商品套图向导" });
    const preview = wizard.getByRole("button", { name: "预览分图方案" });
    await expect(preview).toBeInViewport({ ratio: 1 });
    await expect(
      wizard.getByRole("button", { name: "取消未保存方案" }),
    ).toBeInViewport({ ratio: 1 });
    // Measure the settled glass panel, not a fractional frame of its entrance.
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined)));
    });
    const before = await preview.boundingBox();
    await wizard.getByLabel("商品卖点").fill("柔和釉面，圆润杯口");
    await wizard
      .getByText("高级设置 · 配色、场景与约束", { exact: true })
      .click();
    await expect(preview).toBeInViewport({ ratio: 1 });
    expect((await preview.boundingBox())!.y).toBe(before!.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: info.outputPath(`workbench-${width}.png`),
      animations: "disabled",
    });
    await page.goto("/create");
    await expect(page.getByRole("link", { name: /^开始/ })).toHaveCount(7);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: info.outputPath(`catalogue-${width}.png`),
      animations: "disabled",
      fullPage: true,
    });
  });
}

test("public authentication and legal pages retain the shared glass shell", async ({
  page,
}, info) => {
  await page.goto("/login");
  await page
    .getByRole("navigation", { name: "账号操作" })
    .getByRole("button", { name: "注册", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "创建账号" })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("register.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "忘记密码" }).click();
  await expect(page.getByRole("heading", { name: "找回密码" })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("recovery.png"),
    animations: "disabled",
  });
  for (const path of [
    "/login",
    "/auth/verify",
    "/auth/reset",
    "/terms",
    "/privacy",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("navigation", { name: "网站导航" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: info.outputPath(`${path.slice(1).replaceAll("/", "-")}.png`),
      animations: "disabled",
    });
  }
});

// A 1440×900 desktop browser at 200% exposes 720×450 CSS pixels.
// Native Chrome zoom is checked separately; this guards the corresponding reflow.
test("200 percent equivalent desktop reflow keeps long forms reachable", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto("/?scene=product-set");
  const wizard = page.getByRole("region", { name: "商品套图向导" });
  await wizard.getByLabel("商品名称", { exact: true }).fill("桌面放大检查");
  await wizard.getByLabel("商品卖点").fill("长表单滚动检查");
  const preview = wizard.getByRole("button", { name: "预览分图方案" });
  await preview.scrollIntoViewIfNeeded();
  await expect(preview).toBeInViewport({ ratio: 1 });
  await preview.click();
  await expect(wizard.getByRole("alert")).toContainText("请上传");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: info.outputPath("desktop-200-reflow.png"),
    fullPage: true,
    animations: "disabled",
  });
});
