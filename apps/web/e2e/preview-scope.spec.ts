import { expect, test, type Page } from "@playwright/test";

const product = {
  name: "product.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
};

async function renameActiveSession(page: Page, current: string, next: string) {
  await page.getByRole("button", { name: `重命名 ${current}`, exact: true }).last().click();
  await page.getByRole("textbox", { name: "会话名称" }).fill(next);
  await page.getByRole("button", { name: "保存会话名称" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

test("keeps preview navigation inside the visible conversation while retaining a hidden commerce draft", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await renameActiveSession(page, "新的创作", "B04 电商会话");
  await page.goto("/?scene=product-set");
  const setWizard = page.getByRole("region", { name: "商品套图向导" });
  await setWizard.getByLabel("上传电商参考图").setInputFiles(product);
  await setWizard.getByLabel("商品名称", { exact: true }).fill("暖白陶瓷杯");
  await setWizard.getByRole("button", { name: "预览分图方案" }).click();
  await setWizard.getByRole("button", { name: "确认生成 5 张" }).click();
  const task = page.getByTestId("commerce-task");
  await expect(task.getByRole("img", { name: /当前选图/ })).toHaveCount(5);

  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await renameActiveSession(page, "新的创作", "B04 普通会话");
  await page.getByRole("button", { name: "创建图片" }).click();
  await page.getByRole("button", { name: /^图片设置/ }).click();
  await page.getByRole("button", { name: "生成数量 2", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "创作输入" }).fill("生成两张普通会话预览图");
  await page.getByRole("button", { name: "发送创作请求" }).click();
  const ordinary = page.getByRole("article", { name: "图片生成结果" });
  await expect(ordinary.getByText("已完成", { exact: true })).toBeVisible();
  await expect(ordinary.getByRole("img", { name: /^生成结果/ })).toHaveCount(2);

  await ordinary.getByRole("img", { name: "生成结果 2", exact: true }).click();
  const preview = page.getByRole("dialog");
  await expect(preview.getByText("2 / 2", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(preview.getByText("1 / 2", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "close", exact: true }).click();
  await expect(preview).not.toBeVisible();

  await page.getByRole("button", { name: "B04 电商会话", exact: true }).click();
  await page.getByRole("link", { name: "电商生图", exact: true }).first().click();
  await page.getByRole("link", { name: "开始商品主图 →" }).click();
  const draft = page.getByRole("region", { name: "商品主图向导" });
  await draft.getByLabel("上传电商参考图").setInputFiles(product);
  await draft.getByLabel("商品名称", { exact: true }).fill("切换后仍保留的草稿");
  await renameActiveSession(page, "新的创作", "B04 草稿会话");

  await page.getByRole("button", { name: "生成两张普通会话预览图", exact: true }).click();
  await ordinary.getByRole("img", { name: "生成结果 2", exact: true }).click();
  const restoredPreview = page.getByRole("dialog");
  await expect(restoredPreview.getByText("2 / 2", { exact: true })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("isolated-preview.png") });
  await restoredPreview.getByRole("button", { name: "close", exact: true }).click();
  await expect(restoredPreview).not.toBeVisible();

  await page.getByRole("button", { name: "B04 草稿会话", exact: true }).click();
  await expect(page.getByRole("region", { name: "商品主图向导" }).getByLabel("商品名称", { exact: true })).toHaveValue(
    "切换后仍保留的草稿",
  );
});
