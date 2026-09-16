import { expect, test } from "@playwright/test";
test("shows a consistent wallet, model prices and charged chat ledger", async ({
  page,
}) => {
  await page.goto("/");
  const balance = page.getByRole("button", { name: "查看积分与模型价格" });
  await expect(balance).toHaveText("10.00 积分");
  await expect(page.getByText("本次 0.02 积分", { exact: true })).toBeVisible();
  await balance.click();
  const modal = page.getByRole("dialog");
  await expect(modal).toContainText("0.30 / 张");
  await expect(modal).toContainText("0.80 / 张");
  await expect(modal).toContainText("0.10 / 次");
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("textbox", { name: "创作输入" })
    .fill("给我一句女装店铺介绍");
  await page.getByRole("button", { name: "发送创作请求" }).click();
  await expect(balance).toHaveText("9.98 积分");
  await page.goto("/account");
  await expect(page.getByRole("region", { name: "积分账户" })).toContainText(
    "9.98",
  );
  await expect(
    page.getByRole("cell", { name: "消费", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "积分账户" })).toContainText(
    "9.98",
  );
});
test("free poster save, charged optimization and refund-free undo", async ({
  page,
}) => {
  await page.goto("/?scene=xhs-poster&template=xhs-sketch");
  const wizard = page.getByRole("region", { name: "小红书海报向导" });
  const balance = page.getByRole("button", { name: "查看积分与模型价格" });
  await expect(balance).toHaveText("10.00 积分");
  await wizard.getByLabel("海报标题", { exact: true }).fill("春日女装穿搭");
  await wizard
    .getByLabel("海报内容", { exact: true })
    .fill("简洁衬衫与舒适长裙");
  await wizard
    .getByRole("button", { name: "AI 优化当前内容", exact: true })
    .first()
    .click();
  await expect(balance).toHaveText("9.95 积分");
  await wizard.getByRole("button", { name: "撤销优化" }).click();
  await expect(balance).toHaveText("9.95 积分");
  await wizard.getByRole("button", { name: "预览分图方案" }).click();
  await wizard.getByRole("button", { name: "保存方案，稍后生成" }).click();
  await expect(balance).toHaveText("9.95 积分");
  const task = page.getByTestId("commerce-task");
  await expect(task.getByText(/本次 .* 积分/)).toBeVisible();
  await task.getByRole("button", { name: "确认生成 1 张" }).click();
  await expect(
    task.getByRole("button", { name: "下载当前选图（1 张）" }),
  ).toBeEnabled();
  await expect(balance).not.toHaveText("9.95 积分");
});
