import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  buildCommerceSlots,
  IMAGE_PROVIDER_CAPABILITIES,
  type CommerceBrief,
} from "@zimage/domain";
import { describe, expect, it } from "vitest";
import { cloneElement } from 'react';
import { CommerceWorkspace } from "@/features/commerce/CommerceWorkspace";
import {
  createTestGateway,
  setupWorkspaceTest,
} from "./workspace-test-fixtures";

describe("persistent commerce workbench", () => {
  setupWorkspaceTest();
  it("selects current-session history and switches plan/results without losing the task", async () => {
    const gateway = createTestGateway();
    const session = await gateway.createSession("商品历史");
    const id = await gateway.commerce.upload(session.id, {
      name: "cup.png",
      mimeType: "image/png",
      size: 1,
      status: "ready",
      file: new File(["x"], "cup.png", { type: "image/png" }),
    });
    const brief: CommerceBrief = {
      name: "白杯",
      facts: "陶瓷",
      sellingPoints: "",
      platform: "taobao",
      placement: "商品展示",
      productReferenceIds: [id],
      styleReferenceIds: [],
    };
    const settings = {
      provider: "gemini",
      model: "gemini-3-pro-image",
      aspectRatio: "1:1",
      resolution: "2K",
    } as const;
    for (const name of ["白杯", "蓝杯"])
      await gateway.commerce.create({
        requestId: crypto.randomUUID(),
        sessionId: session.id,
        plan: {
          scene: "product-main",
          brief: { ...brief, name },
          templateId: "white-main",
          slots: buildCommerceSlots(
            { ...brief, name },
            "product-main",
            1,
            settings,
          ),
        },
      });
    const workbench = (
      <CommerceWorkspace
        ref={null}
        gateway={gateway.commerce}
        sessionId={session.id}
        items={[]}
        references={[]}
        capabilities={IMAGE_PROVIDER_CAPABILITIES}
        settings={settings}
        onReferenceAdd={() => {}}
        onReferenceRemove={() => {}}
        onReferenceUploaded={() => {}}
        onReferencesAdopt={() => true}
        renderTimeline={(_items, tail, hasCommerce, loading) =>
          tail && hasCommerce && !loading ? (
            <div role="alert">历史加载失败，请重试</div>
          ) : null
        }
      />
    );
    const view = render(workbench);
    const history = await screen.findByRole("combobox", {
      name: "当前会话任务",
    });
    expect(screen.getByRole("alert", { name: "" })).toHaveTextContent(
      "历史加载失败，请重试",
    );
    const options = within(history).getAllByRole("option");
    expect(options).toHaveLength(2);
    const white = options.find((option) =>
      option.textContent?.includes("白杯"),
    )!;
    fireEvent.change(history, {
      target: { value: (white as HTMLOptionElement).value },
    });
    expect(
      screen.getByRole("complementary", { name: "已保存商品资料" }),
    ).toHaveTextContent("白杯");
    fireEvent.click(screen.getByRole("button", { name: "结果" }));
    expect(
      screen.getAllByText("等待生成").filter((el) => !el.closest("[hidden]")),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "方案" }));
    expect(screen.getByRole("button", { name: "确认生成 1 张" })).toBeEnabled();
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId("commerce-task")
          .filter((el) => !el.closest("[hidden]")),
      ).toHaveLength(1),
    );
    expect(
      (await gateway.commerce.list(session.id)).every(
        (task) => task.runs.length === 0,
      ),
    ).toBe(true);
    view.rerender(cloneElement(workbench, { routeDriven: true, requestedTaskId: (white as HTMLOptionElement).value, requestedView: 'examples' }));
    expect(screen.getByRole('button', { name: '示例' })).toHaveAttribute('aria-pressed', 'true');
    view.rerender(cloneElement(workbench, { routeDriven: true }));
    expect(screen.getByRole('button', { name: '方案' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: '当前会话任务' })).toHaveValue((await gateway.commerce.list(session.id)).at(-1)!.id);
  });
});
