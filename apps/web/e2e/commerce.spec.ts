import { expect, test, type Page } from "@playwright/test";

const product = {
  name: "product.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  ),
};
async function planSet(page: Page, count = 3) {
  await page.goto("/?scene=product-set&platform=xiaohongshu");
  const wizard = page.getByRole("region", { name: "商品套图向导" });
  await wizard.getByLabel("上传电商参考图").setInputFiles(product);
  await wizard.getByLabel("商品名称", { exact: true }).fill("暖白陶瓷杯");
  await wizard.getByText("商品事实（选填）", { exact: true }).click();
  await wizard
    .getByLabel("商品事实", { exact: true })
    .fill("白色陶瓷，圆形杯口");
  await wizard.getByLabel("方案图片数量").click();
  await page
    .locator(".ant-select-item-option-content")
    .filter({ hasText: new RegExp(`^${count}$`) })
    .click();
  await wizard.getByRole("button", { name: "逐图设置" }).click();
  await wizard.getByRole("button", { name: "保存方案，待确认" }).click();
  return page.getByTestId("commerce-task");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/create");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

test("public catalogue filters platform and launches the shared workspace", async ({
  page,
}) => {
  await expect(page.getByRole("link", { name: /^开始/ })).toHaveCount(6);
  await page.getByRole("button", { name: "抖音", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "开始商品套图 →" }),
  ).toHaveAttribute("href", "/?scene=product-set&platform=douyin");
  await page.getByRole("link", { name: "开始商品套图 →" }).click();
  const wizard = page.getByRole("region", { name: "商品套图向导" });
  await expect(
    wizard.locator(".ant-select").filter({ has: page.getByLabel("创作平台") }),
  ).toContainText("抖音", {
    timeout: 30_000,
  });
  await expect(
    wizard.getByRole("heading", { name: "商品套图", exact: true, level: 2 }),
  ).toBeInViewport();
  await wizard.getByRole("button", { name: "开始生成 5 张" }).click();
  await expect(wizard.getByRole("alert")).toHaveText(
    "请上传至少一张清晰的真实商品图。",
  );
  await expect(page.getByRole("article", { name: "图片生成结果" })).toHaveCount(
    0,
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("plans without generation, confirms, restores, edits only the third image and exports a full set", async ({
  page,
}) => {
  // This full journey includes two reloads, generation, edit, history selection and export.
  test.setTimeout(120_000);
  const task = await planSet(page);
  await expect(task.getByRole("status").first()).toHaveText("待确认");
  await expect(
    task.getByRole("button", { name: "下载当前选图（0 张）" }),
  ).toBeDisabled();
  await task.getByRole("button", { name: "确认生成 3 张" }).click();
  await expect(
    task.getByRole("button", { name: "下载当前选图（3 张）" }),
  ).toBeEnabled();
  await page.reload();
  await expect(task).toBeVisible();
  await expect(
    task.getByRole("button", { name: "下载当前选图（3 张）" }),
  ).toBeEnabled();
  await expect(page.getByTestId("direct-generation-prompt")).toHaveCount(0);
  const firstId = await task.getByLabel("第 1 张历史版本").inputValue();
  const thirdId = await task.getByLabel("第 3 张历史版本").inputValue();
  await expect(page.getByRole("textbox", { name: "创作输入" })).toHaveCount(0);
  await task.getByRole("button", { name: "修改第 3 张" }).click();
  const dialog = task.getByRole("dialog", { name: "修改分图方案" });
  await dialog.getByLabel("第 3 张要求").fill("第三张背景换成米色");
  await expect(dialog.getByLabel("第 3 张要求")).toHaveValue(
    "第三张背景换成米色",
  );
  await dialog.getByLabel("第 3 张文案").fill("每天一杯好心情");
  await dialog.getByRole("button", { name: "保存修改方案" }).click();
  await expect(task.getByLabel("第 3 张历史版本")).toHaveValue(thirdId);
  await expect(task.getByText(/当前选图来自旧方案/)).toBeVisible();
  await task.getByRole("button", { name: "确认生成 1 张" }).click();
  await expect(task.getByLabel("第 3 张历史版本")).not.toHaveValue(thirdId);
  await expect(task.getByLabel("第 1 张历史版本")).toHaveValue(firstId);
  await task.getByLabel("第 3 张历史版本").selectOption(thirdId);
  await expect(task.getByLabel("第 3 张历史版本")).toHaveValue(thirdId);
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await task.getByRole("button", { name: "下载当前选图（3 张）" }).click();
  await expect.poll(() => downloads.length).toBe(3);
  await expect(task.getByText("已发起 3 张下载。")).toBeVisible();
  await task.getByRole("button", { name: "归档任务" }).click();
  await expect(task.getByText(/任务已归档/)).toBeVisible();
  await page.reload();
  await expect(task.getByRole("status").first()).toContainText("已归档");
  await expect(
    task.getByRole("button", { name: "确认生成 0 张" }),
  ).toBeDisabled();
  await expect(
    task.getByRole("button", { name: "下载当前选图（3 张）" }),
  ).toBeEnabled();
});

test("explicit scene uses a form and cancelling restores ordinary discussion", async ({
  page,
}) => {
  await page.goto("/?scene=product-main");
  await expect(
    page.getByRole("region", { name: "商品主图向导" }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: "图片生成结果" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("textbox", { name: "创作输入" })).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "电商方案预览" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消未保存方案" }).click();
  await page
    .getByRole("textbox", { name: "创作输入" })
    .fill("先讨论一下如何让商品更突出？");
  await page.getByRole("button", { name: "发送创作请求" }).click();
  await expect(page.getByText(/建议突出主体材质/)).toBeVisible();
  await expect(page.getByRole("article", { name: "图片生成结果" })).toHaveCount(
    0,
  );
});

test("commerce form waits for confirmation and dirty edits cannot submit the old plan", async ({
  page,
}) => {
  const task = await planSet(page, 5);
  await expect(page.getByRole("textbox", { name: "创作输入" })).toHaveCount(0);
  await expect(page.getByTestId("direct-generation-prompt")).toHaveCount(0);
  await expect(
    task.getByRole("button", { name: "下载当前选图（0 张）" }),
  ).toBeDisabled();
  await task.getByRole("button", { name: "修改第 3 张" }).click();
  const dialog = task.getByRole("dialog", { name: "修改分图方案" });
  await dialog.getByLabel("第 3 张文案").fill("确认的新文案");
  await expect(
    task.getByRole("button", { name: "确认生成 5 张" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "保存修改方案" }).click();
  await task.getByRole("button", { name: "确认生成 1 张" }).click();
  await expect(
    task.getByRole("button", { name: "下载当前选图（1 张）" }),
  ).toBeEnabled();
  await expect(task.getByLabel("第 3 张历史版本")).not.toHaveValue("");
  await expect(task.getByLabel("第 1 张历史版本")).toHaveCount(0);
  await expect(page.getByTestId("direct-generation-prompt")).toHaveCount(0);
});

test("product details generate directly and examples load", async ({
  page,
}) => {
  await page.goto("/?scene=product-set");
  const wizard = page.getByRole("region", { name: "商品套图向导" });
  await wizard.getByLabel("上传电商参考图").setInputFiles(product);
  await wizard.getByLabel("商品名称", { exact: true }).fill("米杏色双袋衬衫");
  await expect(
    wizard.getByRole("img", { name: /AI 女装详情示例/ }),
  ).toHaveCount(5);
  await expect
    .poll(() =>
      wizard
        .getByRole("img", { name: /AI 女装详情示例/ })
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  await wizard.getByRole("button", { name: "开始生成 5 张" }).click();
  const task = page.getByTestId("commerce-task");
  await expect(
    task.getByRole("button", { name: "下载当前选图（5 张）" }),
  ).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "创作输入" })).toHaveCount(0);
  await expect(task.getByText(/连接中断/)).toHaveCount(0);
});
