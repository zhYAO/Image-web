import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  COMMERCE_SCENES,
  COMMERCE_PRIMARY_SCENE_IDS,
  IMAGE_PROVIDER_CAPABILITIES,
  type CommerceScene,
  type UploadReference,
} from "@zimage/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommerceWizard } from "@/features/commerce/CommerceWizard";
import { createTestGateway } from "./workspace-test-fixtures";

const settings = {
  provider: "gemini",
  model: "gemini-3-pro-image",
  aspectRatio: "1:1" as const,
  resolution: "2K" as const,
};

beforeEach(() => sessionStorage.clear());

async function renderWizard(
  scene: CommerceScene = "social",
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
  fireEvent.change(screen.getByLabelText(scene === "xhs-poster" ? "海报标题" : ["product-set", "product-main", "detail"].includes(scene) ? "商品描述" : "商品名称"), {
    target: { value: "白色陶瓷杯" },
  });
  if (scene === "xhs-poster") fireEvent.change(screen.getByLabelText("海报内容"), { target: { value: "温热饮品与宁静晨间" } });
  return { gateway, onSaved };
}

describe("commerce plan preview", () => {
  it("keeps the primary example panel visible while editing the form", async () => {
    await renderWizard("product-set", "examples");
    fireEvent.change(screen.getByLabelText("商品描述"), { target: { value: "白色陶瓷杯，适合晨间咖啡" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "一键生成 7 张" })).toBeEnabled());
    expect(screen.getByText("原创 AI 示例 · 用于展示构图与风格，以实际生成效果为准")).toBeVisible();
    expect(screen.queryByLabelText("第 1 张角色")).toBeNull();
  });

  it("keeps primary preview local without a technical editor and submits directly on one-click generation", async () => {
    const { gateway, onSaved } = await renderWizard("product-set");
    const create = vi.spyOn(gateway.commerce, "create");
    const submit = vi.spyOn(gateway.commerce, "submit");

    expect(screen.getByRole("button", { name: /一键生成/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: "调整分图方案" })).toBeNull();
    expect(screen.queryByLabelText("第 1 张角色")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "一键生成 7 张" })).toBeEnabled());
    expect(create).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "一键生成 7 张" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ slots: expect.any(Array), runs: expect.any(Array) }), false));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("invalidates confirmation after left-form edits and preserves customized slot identity", async () => {
    const { gateway } = await renderWizard();
    const create = vi.spyOn(gateway.commerce, "create");
    fireEvent.click(screen.getByRole("button", { name: "调整分图方案" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "一键生成 3 张" })).toBeEnabled());
    const firstRole = screen.getByLabelText("第 1 张角色");
    const firstSlot = firstRole.closest("fieldset")!;
    const firstIdentity = firstSlot.getAttribute("data-slot-id");
    fireEvent.change(firstRole, { target: { value: "自定义封面" } });
    fireEvent.change(screen.getByLabelText("商品卖点"), {
      target: { value: "适合晨间咖啡" },
    });

    expect(screen.getByRole("button", { name: /一键生成/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "调整分图方案" })).toBeVisible();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "调整分图方案" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "一键生成 3 张" })).toBeEnabled());
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
    fireEvent.click(screen.getByRole("button", { name: "调整分图方案" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "一键生成 3 张" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /编辑第 1 张：/ }));
    expect(screen.getByLabelText("第 1 张文案")).toHaveValue(
      "白色陶瓷杯\n初始卖点",
    );

    fireEvent.change(screen.getByLabelText("商品卖点"), {
      target: { value: "更新卖点" },
    });
    fireEvent.click(screen.getByRole("button", { name: "调整分图方案" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "一键生成 3 张" })).toBeEnabled());
    expect(screen.getByLabelText("第 1 张文案")).toHaveValue(
      "白色陶瓷杯\n更新卖点",
    );

    fireEvent.change(screen.getByLabelText("第 1 张文案"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("商品名称"), {
      target: { value: "新商品名" },
    });
    fireEvent.click(screen.getByRole("button", { name: "调整分图方案" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "一键生成 3 张" })).toBeEnabled());
    expect(screen.getByLabelText("第 1 张文案")).toHaveValue("");
  });

  it("keeps the preview draft available when saving fails", async () => {
    const { gateway } = await renderWizard();
    vi.spyOn(gateway.commerce, "create").mockRejectedValueOnce(new Error("保存暂时失败"));
    fireEvent.click(screen.getByRole("button", { name: "调整分图方案" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /编辑第 2 张：/ }));
    fireEvent.change(screen.getByLabelText("第 2 张文案"), {
      target: { value: "手工修改的文案" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存暂时失败");
    expect(screen.getByLabelText("第 2 张文案")).toHaveValue("手工修改的文案");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
  });

  it.each(COMMERCE_SCENES.filter(scene => !COMMERCE_PRIMARY_SCENE_IDS.some(id => id === scene.id)))("keeps selectable slots for legacy $name links", async ({ id, count }) => {
    await renderWizard(id);
    fireEvent.click(screen.getByRole("button", { name: "调整分图方案" }));
    const preview = await screen.findByRole("complementary", { name: "电商方案预览" });
    const selectedIndex = Math.min(1, count - 1);
    const selected = await within(preview).findByRole("button", {
      name: new RegExp(`^编辑第 ${selectedIndex + 1} 张：`),
    });
    fireEvent.click(selected);
    expect(within(preview).getByLabelText(`第 ${selectedIndex + 1} 张角色`)).toBeVisible();
    if (selectedIndex > 0)
      expect(within(preview).queryByLabelText("第 1 张角色")).toBeNull();
  });
  it.each(['product-main', 'product-set', 'detail'] as const)("keeps the %s preview without per-image technical editing", async scene => {
    await renderWizard(scene);
    expect(screen.getByRole('complementary', { name: '电商方案预览' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '调整分图方案' })).toBeNull();
    expect(screen.queryByLabelText('第 1 张角色')).toBeNull();
    expect(screen.queryByLabelText('第 1 张提示词')).toBeNull();
  });
});
