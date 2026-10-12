import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  IMAGE_PROVIDER_CAPABILITIES,
  TRIAL_CREDIT_CATALOG,
  quoteCredits,
  buildCommerceSlots,
  compileCommerceSlot,
  type CommerceScene,
  type CreditItem,
  type UploadReference,
} from "@zimage/domain";
import { CommerceWizard } from "@/features/commerce/CommerceWizard";
import { CommerceDetailPreview } from "@/features/commerce/CommerceDetailPreview";
import { loadCommerceDraft, saveCommerceDraft } from "@/features/commerce/commerce-draft-storage";
import { createTestGateway } from "./workspace-test-fixtures";

const attachments = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@/store/composer-attachments", () => ({
  loadAttachments: attachments.load,
  saveAttachments: attachments.save,
  clearAttachments: attachments.clear,
}));
vi.mock("@/features/commerce/CommerceSelect", () => ({
  CommerceSelect: ({
    children,
    onChange,
    ...props
  }: {
    children: ReactNode;
    onChange: (value: string) => void;
  }) => (
    <select {...props} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  ),
}));
vi.mock("@/features/credits/CreditsProvider", () => ({
  useCredits: () => ({
    catalog: TRIAL_CREDIT_CATALOG,
    wallet: { availableMinor: 1000000 },
    confirm: (items: CreditItem[]) => {
      const quote = quoteCredits(TRIAL_CREDIT_CATALOG, items);
      return { version: quote.version, totalMinor: quote.totalMinor };
    },
  }),
  CreditFee: () => <span>费用预览</span>,
}));
vi.mock("@/features/commerce/CreativeTextField", () => ({
  CreativeTextField: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  ),
}));
const settings = {
  provider: "seedream",
  model: "doubao-seedream-5.0-pro",
  aspectRatio: "1:1" as const,
  resolution: "2K" as const,
};
const ref = (name: string): UploadReference => ({
  id: crypto.randomUUID(),
  name,
  size: 1,
  mimeType: "image/png",
  status: "ready",
});
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  attachments.load.mockResolvedValue([]);
  attachments.save.mockResolvedValue(undefined);
  attachments.clear.mockResolvedValue(undefined);
  URL.revokeObjectURL = vi.fn();
});
async function wizard(scene: CommerceScene, references = [ref("product.png")]) {
  const gateway = createTestGateway();
  const session = await gateway.createSession();
  const onSaved = vi.fn();
  const props = {
    scene,
    references,
    gateway: gateway.commerce,
    sessionId: session.id,
    draftKey: "unit-draft",
    settings,
    capabilities: IMAGE_PROVIDER_CAPABILITIES,
    onSaved,
    onClose: vi.fn(),
    onReferenceAdd: vi.fn(),
    onReferenceRemove: vi.fn(),
    onReferenceUploaded: vi.fn(),
    promotedStyleIds: scene === "clone" ? references.map((r) => r.id!) : [],
  };
  const view = render(<CommerceWizard {...props} />);
  if (scene !== "product-main" || references.length)
    fireEvent.change(screen.getByLabelText("商品描述"), {
      target: { value: "真实陶瓷杯，已确认材质为陶瓷。" },
    });
  return { ...view, props, gateway, session, onSaved };
}

describe("Meitu commerce workflow contracts", () => {
  it.each(['product-set', 'detail', 'clone', 'product-main'] as const)("keeps only output settings in %s without the technical plan editor", async scene => {
    await wizard(scene);
    expect(screen.queryByLabelText('创作平台')).toBeNull();
    expect(screen.queryByLabelText('目标地区')).toBeNull();
    expect(screen.queryByLabelText('画面语言')).toBeNull();
    expect(screen.queryByLabelText('电商生成模型')).toBeNull();
    expect(screen.queryByLabelText('文字优化模型')).toBeNull();
    expect(screen.queryByText('高级设置 · 平台、风格、数量与分图')).toBeNull();
    expect(screen.queryByRole('button', { name: '调整分图方案' })).toBeNull();
    expect(screen.getByLabelText('电商分辨率')).toHaveValue('2K');
    expect(screen.getByLabelText(scene === 'detail' ? 'A+ 输出规格' : '电商画面比例')).toBeVisible();
  });
  it("reuploads retained file bytes when a new local draft has an older session's reference ID", async () => {
    const view = await wizard("product-set");
    view.unmount();
    sessionStorage.clear();
    const file = new File(["product"], "product.png", { type: "image/png" });
    const newReferenceId = crypto.randomUUID();
    const upload = vi.spyOn(view.gateway.commerce, "upload").mockResolvedValue(newReferenceId);
    const create = vi.spyOn(view.gateway.commerce, "create");
    render(<CommerceWizard {...view.props} sessionId="commerce-draft:owner:product-set"
      ensureSession={async () => view.session.id}
      references={[{ ...ref(file.name), id: "previous-session-reference", file }]} />);
    fireEvent.change(screen.getByLabelText("商品描述"), { target: { value: "陶瓷杯" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![1]).not.toHaveProperty("id");
    expect(create.mock.calls[0]![0].plan.brief.productReferenceIds).toEqual([newReferenceId]);
  });
  it("submits the new 1/3/2/1 defaults once, with only user references and selected locale", async () => {
    const { gateway, onSaved, props } = await wizard("product-set");
    const create = vi.spyOn(gateway.commerce, "create");
    const submit = vi.spyOn(gateway.commerce, "submit");
    expect(screen.getByLabelText("white图片数量")).toHaveValue(1);
    expect(screen.getByLabelText("selling图片数量")).toHaveValue(3);
    fireEvent.click(screen.getByRole("button", { name: "一键生成 7 张" }));
    fireEvent.click(screen.getByRole("button", { name: "正在准备…" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledTimes(1);
    const plan = create.mock.calls[0]![0].plan;
    expect(plan.slots.every(slot => slot.provider === 'seedream' && slot.model === 'doubao-seedream-5.0-pro' && slot.aspectRatio === '1:1' && slot.resolution === '2K')).toBe(true);
    expect(plan.brief).toMatchObject({
      platform: "taobao",
      region: "cn",
      language: "zh-CN",
    });
    expect(plan.slots.map((s) => s.category)).toEqual([
      "white",
      "selling",
      "selling",
      "selling",
      "scene",
      "scene",
      "other",
    ]);
    expect(
      plan.slots.every(
        (s) =>
          s.referenceIds.join() === props.references.map((r) => r.id).join(),
      ),
    ).toBe(true);
  });
  it('uses valid preset output options instead of the homepage selection', async () => {
    const view = await wizard('product-set');
    view.unmount();
    sessionStorage.clear();
    const capabilities = [{ provider: 'seedream', models: [{ id: 'doubao-seedream-5.0-pro', label: 'Seedream 5.0 Pro', maxImages: 4, aspectRatios: ['1:1', '3:4'] as const, resolutions: ['2K'] as const }] }];
    const create = vi.spyOn(view.gateway.commerce, 'create');
    render(<CommerceWizard {...view.props} capabilities={capabilities.map(provider => ({ ...provider, models: provider.models.map(model => ({ ...model, aspectRatios: [...model.aspectRatios], resolutions: [...model.resolutions] })) }))} settings={{ ...settings, aspectRatio: '16:9', resolution: '1K' }} />);
    fireEvent.change(screen.getByLabelText('商品描述'), { target: { value: '真实陶瓷杯' } });
    expect(screen.getByLabelText('电商画面比例')).toHaveValue('1:1');
    expect(screen.getByLabelText('电商分辨率')).toHaveValue('2K');
    expect(screen.getByLabelText('电商画面比例').querySelectorAll('option')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].plan.slots.every(slot => slot.provider === 'seedream' && slot.model === 'doubao-seedream-5.0-pro')).toBe(true);
  });
  it('preserves old drafts until explicitly upgrading to Plan before save', async () => {
    const view = await wizard('product-set');
    view.unmount();
    const brief = { name: '旧陶瓷杯', facts: '陶瓷', sellingPoints: '', platform: 'amazon' as const, region: 'us' as const, language: 'en' as const, placement: '商品展示', productReferenceIds: view.props.references.map(reference => reference.id!), styleReferenceIds: [] };
    const slots = buildCommerceSlots(brief, 'product-set', 2, { provider: 'gemini', model: 'gemini-3-pro-image', aspectRatio: '16:9', resolution: '1K' }).map((slot, index) => ({ ...slot, aspectRatio: index ? '3:4' as const : '16:9' as const }));
    saveCommerceDraft('unit-draft', { scene: 'product-set', brief, count: 2, templateId: 'soft-studio', instruction: '', roles: {}, plan: { scene: 'product-set', brief, templateId: 'soft-studio', slots } });
    const create = vi.spyOn(view.gateway.commerce, 'create');
    render(<CommerceWizard {...view.props} />);
    expect(screen.getByLabelText('电商画面比例')).toHaveValue('16:9');
    expect(screen.getByLabelText('电商分辨率')).toHaveValue('1K');
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
    expect(create).not.toHaveBeenCalled();
    expect(loadCommerceDraft('unit-draft')!.plan!.slots.map(slot => slot.aspectRatio)).toEqual(['16:9', '3:4']);
    fireEvent.click(screen.getByRole('button', { name: '使用当前默认参数创建新版本' }));
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].plan.brief).toMatchObject({ platform: 'amazon', region: 'us', language: 'en' });
    expect(create.mock.calls[0]![0].plan.slots).toMatchObject(slots.map(({ id, exactText, instruction, referenceIds }) => ({ id, exactText, instruction, referenceIds, ...settings })));
  });
  it("preserves detail copy across review, refresh, reorder and advanced desktop/mobile variants", async () => {
    const view = await wizard("detail");
    const create = vi.spyOn(view.gateway.commerce, "create");
    expect(screen.getAllByRole("checkbox")).toHaveLength(16);
    fireEvent.change(screen.getByLabelText("A+ 输出规格"), {
      target: { value: "advanced" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /下一步：确认模块内容/ }),
    );
    const text = screen
      .getAllByRole("textbox")
      .find((el) => el.getAttribute("aria-label")?.endsWith("模块文案"))!;
    const moduleName = text.getAttribute("aria-label")!.replace("模块文案", "");
    fireEvent.change(text, { target: { value: "Keep this exact copy" } });
    fireEvent.click(screen.getByRole("button", { name: `下移${moduleName}` }));
    expect(loadCommerceDraft("unit-draft")?.editorStage).toBe("review");
    view.unmount();
    render(<CommerceWizard {...view.props} />);
    expect(screen.getByLabelText(`${moduleName}模块文案`)).toHaveValue(
      "Keep this exact copy",
    );
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const plan = create.mock.calls[0]![0].plan;
    expect(plan.slots).toHaveLength(12);
    const matching = plan.slots.filter((s) => s.module === moduleName);
    expect(
      matching.map((s) => [s.exactText, s.textMode, s.outputSpec]),
    ).toEqual([
      ["Keep this exact copy", "exact", "desktop"],
      ["Keep this exact copy", "exact", "mobile"],
    ]);
    expect(plan.slots[1]?.module).toBe(moduleName);
    expect(
      compileCommerceSlot(plan.brief, matching[0]!, plan.templateId),
    ).toContain("Keep this exact copy");
    await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1));
    view.unmount();
    render(<CommerceDetailPreview task={view.onSaved.mock.calls[0]![0]} />);
    fireEvent.click(screen.getByText("模块顺序与长图预览"));
    expect(
      screen.getByRole("region", { name: "desktop 模块顺序" }),
    ).toHaveTextContent(`2. ${moduleName}`);
    expect(
      screen.getByRole("region", { name: "mobile 模块顺序" }),
    ).toHaveTextContent(`2. ${moduleName}`);
  });
  it("pairs clone references with individual instructions and preserves link-import state", async () => {
    const { gateway, props } = await wizard("clone", [
      ref("first.png"),
      ref("second.png"),
    ]);
    const create = vi.spyOn(gateway.commerce, "create");
    fireEvent.change(screen.getByLabelText("统一复刻要求（选填）"), {
      target: { value: "统一蓝色背景" },
    });
    fireEvent.change(screen.getByLabelText("参考图 2 要求"), {
      target: { value: "仅第二张增加自然光" },
    });
    fireEvent.click(screen.getByRole("button", { name: "导入链接" }));
    expect(screen.getByLabelText("公开商品链接")).toBeVisible();
    expect(loadCommerceDraft("unit-draft")?.referenceSource).toBe("url");
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const slots = create.mock.calls[0]![0].plan.slots;
    expect(slots.map((s) => s.referenceIds)).toEqual(
      props.references.map((r) => [r.id]),
    );
    expect(slots.map((s) => s.instruction)).toEqual([
      "统一蓝色背景",
      "统一蓝色背景\n仅第二张增加自然光",
    ]);
  });
  it("starts AI product images with upload and never submits the showcase image", async () => {
    const view = await wizard("product-main", []);
    const create = vi.spyOn(view.gateway.commerce, "create");
    expect(screen.getByText("上传或拖放图片至此处，开始创作")).toBeVisible();
    expect(screen.queryByRole("button", { name: /一键生成/ })).toBeNull();
    view.rerender(
      <CommerceWizard {...view.props} references={[ref("real.png")]} />,
    );
    fireEvent.change(screen.getByLabelText("商品描述"), {
      target: { value: "陶瓷杯" },
    });
    fireEvent.change(screen.getByLabelText("方案图片数量"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "自定义" }));
    fireEvent.change(screen.getByLabelText("场景描述"), {
      target: { value: "木质桌面自然光" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].plan.slots).toHaveLength(4);
    expect(
      create.mock.calls[0]![0].plan.slots.every(
        (s) => s.instruction === "木质桌面自然光",
      ),
    ).toBe(true);
  });
});
