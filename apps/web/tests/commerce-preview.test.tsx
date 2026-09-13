import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  COMMERCE_SCENES,
  IMAGE_PROVIDER_CAPABILITIES,
  type CommerceScene,
  type UploadReference,
} from "@zimage/domain";
import { describe, expect, it, vi } from "vitest";
import { CommerceWizard } from "@/features/commerce/CommerceWizard";
import { createTestGateway } from "./workspace-test-fixtures";

const settings = {
  provider: "gemini",
  model: "gemini-3-pro-image",
  aspectRatio: "1:1" as const,
  resolution: "2K" as const,
};

async function renderWizard(
  scene: CommerceScene = "product-set",
  previewPanel?: "examples" | "plan",
) {
  const gateway = createTestGateway();
  const session = await gateway.createSession("预览方案测试");
  const reference: UploadReference = {
    id: crypto.randomUUID(),
    name: "商品.png",
    mimeType: "image/png",
    size: 1,
    status: "ready",
  };
  const styleReference: UploadReference = {
    id: crypto.randomUUID(),
    name: "风格.png",
    mimeType: "image/png",
    size: 1,
    status: "ready",
  };
  const references =
    scene === "style-reference" ? [reference, styleReference] : [reference];
  const onSaved = vi.fn();
  render(
    <CommerceWizard
      scene={scene}
      previewPanel={previewPanel}
      promotedStyleIds={scene === "style-reference" ? [styleReference.id!] : []}
      sessionId={session.id}
      gateway={gateway.commerce}
      references={references}
      capabilities={IMAGE_PROVIDER_CAPABILITIES}
      settings={settings}
      onReferenceAdd={() => undefined}
      onReferenceRemove={() => undefined}
      onReferenceUploaded={() => undefined}
      onSaved={onSaved}
      onClose={() => undefined}
    />,
  );
  fireEvent.change(screen.getByLabelText(scene === "xhs-poster" ? "海报标题" : "商品名称"), {
    target: { value: "白色陶瓷杯" },
  });
  if (scene === "xhs-poster") fireEvent.change(screen.getByLabelText("海报内容"), { target: { value: "温热饮品与宁静晨间" } });
  return { gateway, onSaved };
}

describe("commerce plan preview", () => {
  it("lets an enclosing workbench keep the examples panel selected after preview", async () => {
    await renderWizard("product-set", "examples");
    fireEvent.click(screen.getByRole("button", { name: "预览分图方案" }));
    await screen.findByRole("button", { name: "确认生成 5 张" });
    expect(screen.getByText("预览对应所选模板的视觉方向，不是你的生成结果；其他分图按各自角色布局呈现。")).toBeVisible();
    expect(screen.queryByLabelText("第 1 张角色")).toBeNull();
  });

  it("does not create or submit until the preview is explicitly confirmed", async () => {
    const { gateway, onSaved } = await renderWizard();
    const create = vi.spyOn(gateway.commerce, "create");
    const submit = vi.spyOn(gateway.commerce, "submit");

    expect(screen.queryByRole("button", { name: /确认生成/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "预览分图方案" }));

    expect(await screen.findByRole("button", { name: "确认生成 5 张" })).toBeVisible();
    expect(create).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认生成 5 张" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ slots: expect.any(Array) }), true);
    expect(submit).not.toHaveBeenCalled();
  });

  it("invalidates confirmation after left-form edits and preserves customized slot identity", async () => {
    const { gateway } = await renderWizard();
    const create = vi.spyOn(gateway.commerce, "create");
    fireEvent.click(screen.getByRole("button", { name: "预览分图方案" }));
    await screen.findByRole("button", { name: "确认生成 5 张" });
    const firstRole = screen.getByLabelText("第 1 张角色");
    const firstSlot = firstRole.closest("fieldset")!;
    const firstIdentity = firstSlot.getAttribute("data-slot-id");
    fireEvent.change(firstRole, { target: { value: "自定义封面" } });
    fireEvent.change(screen.getByLabelText("商品卖点"), {
      target: { value: "适合晨间咖啡" },
    });

    expect(screen.queryByRole("button", { name: /确认生成/ })).toBeNull();
    expect(screen.getByRole("button", { name: "预览分图方案" })).toBeVisible();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "预览分图方案" }));
    await screen.findByRole("button", { name: "确认生成 5 张" });
    expect(screen.getByLabelText("第 1 张角色")).toHaveValue("自定义封面");
    expect(screen.getByLabelText("第 1 张角色").closest("fieldset")).toHaveAttribute(
      "data-slot-id",
      firstIdentity,
    );
  });

  it("refreshes generated exact text while preserving an explicitly cleared slot", async () => {
    await renderWizard();
    fireEvent.change(screen.getByLabelText("商品卖点"), {
      target: { value: "初始卖点" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览分图方案" }));
    await screen.findByRole("button", { name: "确认生成 5 张" });
    fireEvent.click(screen.getByRole("button", { name: /编辑第 2 张：/ }));
    expect(screen.getByLabelText("第 2 张文案")).toHaveValue(
      "白色陶瓷杯\n初始卖点",
    );

    fireEvent.change(screen.getByLabelText("商品卖点"), {
      target: { value: "更新卖点" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览分图方案" }));
    await screen.findByRole("button", { name: "确认生成 5 张" });
    expect(screen.getByLabelText("第 2 张文案")).toHaveValue(
      "白色陶瓷杯\n更新卖点",
    );

    fireEvent.change(screen.getByLabelText("第 2 张文案"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("商品名称"), {
      target: { value: "新商品名" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览分图方案" }));
    await screen.findByRole("button", { name: "确认生成 5 张" });
    expect(screen.getByLabelText("第 2 张文案")).toHaveValue("");
  });

  it("keeps the preview draft available when saving fails", async () => {
    const { gateway } = await renderWizard();
    vi.spyOn(gateway.commerce, "create").mockRejectedValueOnce(new Error("保存暂时失败"));
    fireEvent.click(screen.getByRole("button", { name: "预览分图方案" }));
    await screen.findByRole("button", { name: "保存方案，稍后生成" });
    fireEvent.click(screen.getByRole("button", { name: /编辑第 2 张：/ }));
    fireEvent.change(screen.getByLabelText("第 2 张文案"), {
      target: { value: "手工修改的文案" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存方案，稍后生成" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存暂时失败");
    expect(screen.getByLabelText("第 2 张文案")).toHaveValue("手工修改的文案");
    expect(screen.getByRole("button", { name: "保存方案，稍后生成" })).toBeEnabled();
  });

  it.each(COMMERCE_SCENES)("shows selectable per-scene slots for $name", async ({ id, roles, count }) => {
    await renderWizard(id);
    fireEvent.click(screen.getByRole("button", { name: "预览分图方案" }));
    const preview = await screen.findByRole("complementary", { name: "电商方案预览" });
    const selectedIndex = Math.min(1, count - 1);
    const selected = within(preview).getByRole("button", {
      name: `编辑第 ${selectedIndex + 1} 张：${roles[selectedIndex % roles.length]}`,
    });
    fireEvent.click(selected);
    expect(within(preview).getByLabelText(`第 ${selectedIndex + 1} 张角色`)).toBeVisible();
    if (selectedIndex > 0)
      expect(within(preview).queryByLabelText("第 1 张角色")).toBeNull();
  });
});
