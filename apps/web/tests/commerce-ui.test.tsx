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
  type CommerceTask,
  type UploadReference,
  WorkspaceError,
} from "@zimage/domain";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommerceWizard } from "@/features/commerce/CommerceWizard";
import { CommerceCatalogue } from "@/features/commerce/CommerceCatalogue";
import { CommerceTaskCard } from "@/features/commerce/CommerceTaskCard";
import {
  exportCommerceImages,
  isExplicitImageRequest,
  resolveCommerceLaunch,
} from "@/features/commerce/commerce-ui";
import { UnifiedWorkspace } from "@/features/workspace/UnifiedWorkspace";
import { useWorkspaceStore } from "@/store/workspace-store";
import * as downloads from "@/features/workspace/download-images";
import {
  CapturingGateway,
  createTestGateway,
  setupWorkspaceTest,
} from "./workspace-test-fixtures";

async function chooseCommerceOption(control: HTMLElement, label: string) {
  fireEvent.click(control);
  fireEvent.click(await screen.findByRole('option', { name:label }));
}

async function chooseCommerceValue(control: HTMLElement, value: string) {
  fireEvent.click(control);
  const option = await waitFor(() => {
    const match = screen.getAllByRole('option').find(item => item.getAttribute('data-value') === value);
    expect(match).toBeDefined();
    return match!;
  });
  fireEvent.click(option);
}

async function createPlan(
  gateway: ReturnType<typeof createTestGateway>,
  count = 3,
) {
  const session = await gateway.createSession("测试商品套图");
  const reference = await gateway.commerce.upload(session.id, {
    file: new File(["x"], "product.png", { type: "image/png" }),
    name: "product.png",
    mimeType: "image/png",
    size: 1,
    status: "ready",
  });
  const brief: CommerceBrief = {
    name: "陶瓷杯",
    facts: "白色陶瓷",
    sellingPoints: "",
    platform: "taobao",
    placement: "商品展示",
    productReferenceIds: [reference],
    styleReferenceIds: [],
  };
  const slots = buildCommerceSlots(brief, "product-set", count, {
    provider: "seedream",
    model: "doubao-seedream-5.0-pro",
    aspectRatio: "1:1",
    resolution: "2K",
  });
  return gateway.commerce.create({
    requestId: crypto.randomUUID(),
    sessionId: session.id,
    plan: { brief, slots, scene: "product-set", templateId: "soft-studio" },
  });
}

async function completedPlan(
  gateway: ReturnType<typeof createTestGateway>,
  plan: CommerceTask,
) {
  let result: CommerceTask | undefined;
  // Admission and completion are distinct even with a zero-delay provider fixture.
  await waitFor(async () => {
    result = await gateway.commerce.get(plan.id);
    expect(result.selections).toHaveLength(plan.slots.length);
  });
  return result!;
}

function Card({
  initial,
  gateway,
}: {
  initial: CommerceTask;
  gateway: ReturnType<typeof createTestGateway>;
}) {
  const [task, setTask] = useState(initial);
  return (
    <CommerceTaskCard
      task={task}
      gateway={gateway.commerce}
      capabilities={IMAGE_PROVIDER_CAPABILITIES}
      onDiscuss={() => undefined}
      onTask={(next) => {
        setTask(next);
        void gateway.commerce.get(next.id).then(setTask);
      }}
    />
  );
}

describe("commerce UI", () => {
  setupWorkspaceTest();
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
  });

  it("offers five primary scenes after retiring batch creation and keeps the remaining launch URLs compatible", () => {
    render(<CommerceCatalogue />);
    expect(screen.getAllByRole("link", { name: /^开始/ })).toHaveLength(5);
    expect(screen.queryByRole("link", { name: "开始批量生成 →" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "开始商品套图 →" }),
    ).toHaveAttribute("href", "/create/product-set");
    expect(screen.queryByLabelText("平台筛选")).toBeNull();
    expect(screen.queryByText("更多创作")).toBeNull();
    expect(screen.queryByText("原创风格方向")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "搜索电商工具" })).toBeNull();
    expect(screen.getByRole("link", { name: "开始服装商品图片 →" })).toHaveAttribute("href", "/create/apparel-catalog");
    expect(screen.queryByRole("button", { name: /分析/ })).toBeNull();
    expect(resolveCommerceLaunch("?scene=product-set&platform=douyin")).toEqual(
      { scene: "product-set", platform: "douyin" },
    );
    expect(resolveCommerceLaunch("?scene=unknown&platform=unknown")).toEqual({
      scene: undefined,
      platform: undefined,
    });
  });

  it("does not report an unknown result during a normal slow submit", async () => {
    const gateway = createTestGateway();
    const task = await createPlan(gateway, 1);
    let release!: () => void;
    const submit = gateway.commerce.submit.bind(gateway.commerce);
    vi.spyOn(gateway.commerce, "submit").mockImplementation(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return submit(...args);
    });
    render(<Card initial={task} gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "确认生成 1 张" }));
    expect(screen.getByRole("button", { name: "正在处理…" })).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
    release();
    await screen.findByText("已确认，正在逐图生成。");
  });

  it("generates a product from its description with one click and rejects double clicks", async () => {
    window.history.replaceState({}, "", "/?scene=product-set");
    const gateway = createTestGateway();
    const submit = vi.spyOn(gateway.commerce, "submit");
    render(<UnifiedWorkspace gateway={gateway} />);
    const wizard = await screen.findByRole("region", { name: "商品套图向导" });
    fireEvent.change(within(wizard).getByLabelText("上传电商参考图"), {
      target: { files: [new File(["x"], "cup.png", { type: "image/png" })] },
    });
    fireEvent.change(
      within(wizard).getByRole("textbox", { name: "商品描述" }),
      { target: { value: "白色陶瓷杯" } },
    );
    const start = within(wizard).getByRole("button", { name: "一键生成 7 张" });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]?.[1].slotIds).toHaveLength(7);
    expect(await screen.findByTestId("commerce-task")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "创作输入" })).toBeNull();
  });

  it("distinguishes discussion from explicit generic image intent", () => {
    expect(isExplicitImageRequest("这套图片怎么改更好？")).toBe(false);
    expect(isExplicitImageRequest("先不要生成图片")).toBe(false);
    expect(isExplicitImageRequest("生成一张杯子图片")).toBe(true);
  });

  it('creates a new saved version for an unavailable historical model without changing its content or generating', async () => {
    const gateway = createTestGateway();
    const original = await createPlan(gateway, 2);
    const old = { ...original, slots: original.slots.map(slot => ({ ...slot, provider: 'seedream', model: 'seedream-4.5' })) };
    const save = vi.spyOn(gateway.commerce, 'save');
    const submit = vi.spyOn(gateway.commerce, 'submit');
    render(<Card initial={old} gateway={gateway} />);
    fireEvent.click(screen.getByRole('button', { name: '使用当前默认参数创建新版本' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[1]).toMatchObject({ expectedRevision: 1, plan: { brief: old.brief, slots: old.slots.map(slot => ({ ...slot, provider: 'seedream', model: 'doubao-seedream-5.0-pro', aspectRatio: '1:1', resolution: '2K' })) } });
    await screen.findByText(/新版本已保存/);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '修改第 1 张' }));
    expect(screen.queryByLabelText('第 1 张模型')).toBeNull();
    expect(screen.queryByLabelText('第 1 张比例')).toBeNull();
  });

  it("explicit commerce launch asks one missing question before any generation", async () => {
    window.history.replaceState({}, "", "/?scene=product-main");
    const gateway = createTestGateway(CapturingGateway);
    const submit = vi.spyOn(gateway.commerce, "submit");
    render(<UnifiedWorkspace gateway={gateway} />);
    const wizard = await screen.findByRole("region", { name: "AI 商品图向导" });
    expect(within(wizard).getByText('在左侧上传或拖放商品图片，开始创作。')).toBeVisible();
    expect(within(wizard).getByLabelText('上传电商参考图')).toBeEnabled();
    expect(within(wizard).queryByRole('button', { name: /一键生成/ })).toBeNull();
    expect(gateway.lastImageRequest).toBeUndefined();
    expect(gateway.lastChatRequest).toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
  });

  it("enabled image tool still sends an ordinary discussion as chat with no generation", async () => {
    const gateway = createTestGateway(CapturingGateway);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByText("你好，想创作什么？");
    useWorkspaceStore.getState().setExplicitImageToolEnabled(true);
    fireEvent.change(screen.getByRole("textbox", { name: "创作输入" }), {
      target: { value: "帮我分析这套图片为什么不协调？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送创作请求" }));
    await waitFor(() => expect(gateway.lastChatRequest).toBeDefined());
    expect(gateway.lastChatRequest?.imageToolEnabled).toBe(false);
    expect(gateway.lastImageRequest).toBeUndefined();
  });

  it("uploads shared roles, saves without generation, confirms a subset and restores the task without duplicate child batches", async () => {
    window.history.replaceState(
      null,
      "",
      "/?scene=style-reference&platform=douyin",
    );
    const gateway = createTestGateway();
    const submit = vi.spyOn(gateway.commerce, "submit");
    const upload = vi.spyOn(gateway.commerce, "upload");
    const create = vi.spyOn(gateway.commerce, "create");
    const view = render(<UnifiedWorkspace gateway={gateway} />);
    const wizard = await screen.findByRole("region", { name: "参考风格向导" });
    fireEvent.change(within(wizard).getByLabelText("上传电商参考图"), {
      target: {
        files: [
          new File(["a"], "product.png", { type: "image/png" }),
          new File(["b"], "style.png", { type: "image/png" }),
        ],
      },
    });
    await chooseCommerceOption(
      within(wizard).getByLabelText("参考图 2 用途"),
      "风格参考图",
    );
    fireEvent.change(
      within(wizard).getByRole("textbox", { name: "商品描述" }),
      { target: { value: "陶瓷杯" } },
    );
    await chooseCommerceOption(
      within(wizard).getByLabelText("方案图片数量"),
      "3",
    );
    fireEvent.click(within(wizard).getByRole("button", { name: "调整分图方案" }));
    await within(wizard).findByRole("button", { name: "保存草稿" });
    expect(upload).not.toHaveBeenCalled();
    fireEvent.click(
      await within(wizard).findByRole("button", { name: "保存草稿" }),
    );
    const task = await screen.findByTestId("commerce-task");
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0]?.[1]).not.toHaveProperty("previewUrl");
    expect(
      useWorkspaceStore
        .getState()
        .references.every((reference) => reference.id),
    ).toBe(true);

    expect(create.mock.calls[0]?.[0].plan.brief).toMatchObject({
      platform: "douyin",
      productReferenceIds: [expect.any(String)],
      styleReferenceIds: [expect.any(String)],
    });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(within(task).getByLabelText("生成第 2 张"));
    fireEvent.click(within(task).getByLabelText("生成第 3 张"));
    fireEvent.click(
      within(task).getByRole("button", { name: "确认生成 1 张" }),
    );
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]?.[1].slotIds).toHaveLength(1);
    // Wait cheaply for the terminal label before the accessibility-tree lookup.
    // Repeated getByRole scans across AntD controls can starve the mock timers in jsdom.
    await within(task).findByText("ZIP 下载当前选图（1 张）", {}, { timeout: 12000 });
    expect(within(task).getByRole("button", { name: "ZIP 下载当前选图（1 张）" })).toBeEnabled();
    view.unmount();
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByTestId("commerce-task");
    await screen.findByRole("button", { name: "ZIP 下载当前选图（1 张）" });
    expect(screen.getAllByTestId("commerce-task")).toHaveLength(1);
    expect(screen.queryByTestId("direct-generation-prompt")).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("modifies one slot through a saved plan, defaults to the new result, preserves all other outputs and allows selecting the old version", async () => {
    const gateway = createTestGateway();
    const plan = await createPlan(gateway);
    await gateway.commerce.submit(plan.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: plan.slots.map((slot) => slot.id),
    });
    const ready = await completedPlan(gateway, plan);
    const submit = vi.spyOn(gateway.commerce, "submit");
    const save = vi.spyOn(gateway.commerce, "save");
    render(<Card initial={ready} gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "修改第 3 张" }));
    const dialog = screen.getByRole("dialog", { name: "修改分图方案" });
    fireEvent.change(within(dialog).getByLabelText("第 3 张文案"), {
      target: { value: "每天一杯好心情" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "保存修改方案" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(submit).not.toHaveBeenCalled();
    await screen.findByText(/当前选图来自旧方案/);
    fireEvent.click(
      await screen.findByRole("button", { name: "确认生成 1 张" }),
    );
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]?.[1].slotIds).toEqual([plan.slots[2]!.id]);
    fireEvent.click(screen.getByRole("combobox", { name:"第 3 张历史版本" }));
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.click(screen.getByRole("combobox", { name:"第 3 张历史版本" }));
    const updated = await gateway.commerce.get(plan.id);
    expect(
      updated.selections.find((item) => item.slotId === plan.slots[0]!.id)
        ?.generationId,
    ).toBe(
      ready.selections.find((item) => item.slotId === plan.slots[0]!.id)
        ?.generationId,
    );
    const oldId = ready.selections.find(
      (item) => item.slotId === plan.slots[2]!.id,
    )!.generationId;
    expect(updated.selections.find(item => item.slotId === plan.slots[2]!.id)?.generationId).not.toBe(oldId);
    await chooseCommerceValue(screen.getByRole("combobox", { name:"第 3 张历史版本" }), oldId);
    await waitFor(async () => expect((await gateway.commerce.get(plan.id)).selections.find(item => item.slotId === plan.slots[2]!.id)?.generationId).toBe(oldId));
    expect(
      screen.getByRole("button", { name: "ZIP 下载当前选图（3 张）" }),
    ).toBeEnabled();
  });

  it("retains the exact confirmation request through network failure and remount, and only replays that request", async () => {
    const gateway = createTestGateway();
    const plan = await createPlan(gateway, 1);
    const submit = vi
      .spyOn(gateway.commerce, "submit")
      .mockRejectedValueOnce(new Error("网络断开，提交结果未知"));
    const first = render(<Card initial={plan} gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "确认生成 1 张" }));
    await screen.findByText(/网络断开/);
    expect(
      screen.getByRole("button", { name: "确认生成 1 张" }),
    ).toBeDisabled();
    const original = submit.mock.calls[0]?.[1];
    first.unmount();
    render(<Card initial={plan} gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "恢复原提交" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]?.[1]).toEqual(original);
    await screen.findByRole("button", { name: "ZIP 下载当前选图（1 张）" });
    expect(
      window.sessionStorage.getItem(`zimage-commerce-submit:${plan.id}`),
    ).toBeNull();
  });

  it("replays a rejected queue request with the same ID, but creates a new ID for edited content", async () => {
    const gateway = createTestGateway();
    const plan = await createPlan(gateway, 1);
    const full = new WorkspaceError({
      code: "QUOTA_EXCEEDED",
      message: "整组未入队：额度不足，请减少图片数量。",
      retryable: false,
    });
    const submit = vi
      .spyOn(gateway.commerce, "submit")
      .mockRejectedValueOnce(full)
      .mockRejectedValueOnce(full);
    render(<Card initial={plan} gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "确认生成 1 张" }));
    await screen.findByText(full.message);
    fireEvent.click(screen.getByRole("button", { name: "恢复原提交" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]?.[1].requestId).toBe(
      submit.mock.calls[0]?.[1].requestId,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "修改第 1 张" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "修改第 1 张" }));
    fireEvent.change(screen.getByLabelText("第 1 张文案"), {
      target: { value: "确认的新文案" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改方案" }));
    await screen.findByText(/修改方案已保存/);
    fireEvent.click(screen.getByRole("button", { name: "确认生成 1 张" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
    expect(submit.mock.calls[2]?.[1].revision).toBe(2);
    expect(submit.mock.calls[2]?.[1].requestId).not.toBe(
      submit.mock.calls[0]?.[1].requestId,
    );
  });

  it.each(["provider_result_unknown", "result_storage_failed"])(
    "prevents ordinary retries for unsettled %s results",
    async (error) => {
      const gateway = createTestGateway();
      const plan = await createPlan(gateway, 1);
      const uncertain: CommerceTask = {
        ...plan,
        runs: [
          {
            id: crypto.randomUUID(),
            requestId: crypto.randomUUID(),
            revision: 1,
            createdAt: plan.createdAt,
            items: [
              {
                slotId: plan.slots[0]!.id,
                batchId: crypto.randomUUID(),
                generationId: crypto.randomUUID(),
                status: "failed",
                error,
                compatibilityHash: plan.slotHashes[plan.slots[0]!.id]!,
                selectionVersion: 0,
              },
            ],
          },
        ],
      };
      render(<Card initial={uncertain} gateway={gateway} />);
      expect(
        screen.getByText(/请联系支持核对任务/),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("生成第 1 张")).toBeDisabled();
      expect(screen.getByRole("button", { name: "选择全部" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "确认生成 0 张" }),
      ).toBeDisabled();
    },
  );

  it("freezes the ordered complete selection through gateway export before invoking existing download helpers", async () => {
    const gateway = createTestGateway();
    const plan = await createPlan(gateway, 3);
    await gateway.commerce.submit(plan.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: plan.slots.map((slot) => slot.id),
    });
    const ready = await completedPlan(gateway, plan);
    const exported = vi.spyOn(gateway.commerce, "export");
    const downloaded = vi
      .spyOn(downloads, "downloadImages")
      .mockResolvedValue({ downloaded: 3, failed: 0 });
    const message = await exportCommerceImages(
      gateway.commerce,
      ready,
      ready.slots.map((slot) => slot.id),
    );
    expect(exported.mock.calls[0]?.[1].selections).toEqual(
      ready.slots.map((slot) => ({
        slotId: slot.id,
        generationId: ready.selections.find((item) => item.slotId === slot.id)!
          .generationId,
      })),
    );
    expect(
      downloaded.mock.calls[0]?.[0].assets.map((asset) => asset.id),
    ).toEqual(
      exported.mock.calls[0]?.[1].selections.map((item) => item.generationId),
    );
    expect(message).toBe("已发起 3 张下载。");
  });
  it("promotes a successful sample into a shared style reference and opens a separate draft without generating", async () => {
    // Regression: real timers must not determine which fixture session opens.
    vi.useFakeTimers({ toFake: ["Date"] });
    const gateway = createTestGateway();
    const original = await createPlan(gateway, 1);
    await gateway.commerce.submit(original.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: original.slots.map((slot) => slot.id),
    });
    const ready = await completedPlan(gateway, original);
    const promote = vi.spyOn(gateway.commerce, "promote");
    const submit = vi.spyOn(gateway.commerce, "submit");
    render(<UnifiedWorkspace gateway={gateway} />);
    const task = await screen.findByTestId("commerce-task");
    fireEvent.click(
      within(task).getByRole("button", { name: "采用第 1 张为风格参考" }),
    );
    const wizard = await screen.findByRole("region", { name: "商品套图向导" });
    expect(within(wizard).getByLabelText("商品描述")).toHaveValue("陶瓷杯\n白色陶瓷");
    expect(
      within(wizard).getByLabelText("参考图 2 用途").closest(".glide-select"),
    ).toHaveTextContent("风格参考图");
    expect(within(wizard).getByLabelText("参考图 2 用途")).toBeDisabled();
    expect(promote.mock.calls[0]?.[1].generationId).toBe(
      ready.selections[0]!.generationId,
    );
    expect(useWorkspaceStore.getState().references).toHaveLength(2);
    expect(useWorkspaceStore.getState().references[1]).toMatchObject({
      name: "生成样图.png",
      mimeType: "image/png",
      size: 1024,
      status: "ready",
    });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(
      await within(wizard).findByRole("button", { name: "保存草稿" }),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("commerce-task")).toHaveLength(2),
    );
    const tasks = await gateway.commerce.list(original.sessionId);
    expect(tasks.find((item) => item.id === original.id)?.revision).toBe(1);
    expect(
      tasks.find((item) => item.id !== original.id)?.brief.styleReferenceIds,
    ).toHaveLength(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it("requires explicit removal before adopting a sample into a four-reference plan", async () => {
    const gateway = createTestGateway();
    const original = await createPlan(gateway, 1);
    const ids = [...original.brief.productReferenceIds];
    for (let index = 0; index < 3; index++)
      ids.push(
        await gateway.commerce.upload(original.sessionId, {
          file: new File(["x"], `product-${index}.png`, { type: "image/png" }),
          name: "product.png",
          mimeType: "image/png",
          size: 1,
          status: "ready",
        }),
      );
    const full = await gateway.commerce.save(original.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      plan: {
        scene: original.scene,
        templateId: original.templateId,
        brief: { ...original.brief, productReferenceIds: ids },
        slots: original.slots.map((slot) => ({ ...slot, referenceIds: ids })),
      },
    });
    await gateway.commerce.submit(full.id, {
      requestId: crypto.randomUUID(),
      revision: full.revision,
      slotIds: full.slots.map((slot) => slot.id),
    });
    const promote = vi.spyOn(gateway.commerce, "promote");
    render(<UnifiedWorkspace gateway={gateway} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "采用第 1 张为风格参考" }),
    );
    await screen.findByText(/请先明确移除一张/);
    expect(promote).not.toHaveBeenCalled();
    const wizard = await screen.findByRole("region", { name: "商品套图向导" });
    fireEvent.click(
      within(wizard).getByRole("button", { name: "移除参考图 4" }),
    );
    await chooseCommerceValue(screen.getByRole("combobox", { name:"当前会话任务" }), full.id);
    fireEvent.click(
      screen.getByRole("button", { name: "采用第 1 张为风格参考" }),
    );
    await waitFor(() => expect(promote).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        within(wizard).getByLabelText("参考图 4 用途").closest(".glide-select"),
      ).toHaveTextContent("风格参考图"),
    );
    expect(useWorkspaceStore.getState().references).toHaveLength(4);
  });
  it("restores only outdated slots as awaiting confirmation using opaque server hashes", async () => {
    const gateway = createTestGateway();
    const original = await createPlan(gateway, 3);
    await gateway.commerce.submit(original.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: original.slots.map((slot) => slot.id),
    });
    const ready = await completedPlan(gateway, original);
    const task = {
      ...ready,
      revision: 2,
      slotHashes: {
        ...ready.slotHashes,
        [ready.slots[2]!.id]: "opaque-revised-hash",
      },
    };
    render(<Card initial={task} gateway={gateway} />);
    expect(screen.getByLabelText("生成第 1 张")).not.toBeChecked();
    expect(screen.getByLabelText("生成第 2 张")).not.toBeChecked();
    expect(screen.getByLabelText("生成第 3 张")).toBeChecked();
    expect(screen.getByRole("button", { name: "确认生成 1 张" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "ZIP 下载当前选图（3 张）" }),
    ).toBeEnabled();
  });
  it("archives through the gateway, prevents new generation and preserves selected history/downloads", async () => {
    const gateway = createTestGateway();
    const original = await createPlan(gateway, 1);
    await gateway.commerce.submit(original.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: original.slots.map((slot) => slot.id),
    });
    const ready = await completedPlan(gateway, original);
    const archive = vi.spyOn(gateway.commerce, "archive");
    render(<Card initial={ready} gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "归档任务" }));
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    await screen.findByText(/任务已归档/);
    expect(
      screen.getByRole("button", { name: "确认生成 0 张" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "修改第 1 张" })).toBeDisabled();
    expect(screen.getByLabelText("第 1 张历史版本")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "ZIP 下载当前选图（1 张）" }),
    ).toBeEnabled();
    expect((await gateway.commerce.get(original.id)).archived).toBe(true);
  });

  it("cancels only pending images and keeps a claimed processing image running", async () => {
    let starts = 0;
    const release: Array<() => void> = [];
    const gateway = createTestGateway(CapturingGateway, {
      delay: async (milliseconds) => {
        if (milliseconds === 900 && ++starts === 1) return;
        await new Promise<void>((resolve) => release.push(resolve));
      },
    });
    const original = await createPlan(gateway, 2);
    await gateway.commerce.submit(original.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: original.slots.map((slot) => slot.id),
    });
    const running = await gateway.commerce.get(original.id);
    expect(running.runs[0]!.items.map((item) => item.status)).toEqual([
      "processing",
      "pending",
    ]);
    const cancel = vi.spyOn(gateway.commerce, "cancel");
    render(<Card initial={running} gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "取消未派发图片" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    await screen.findByText(/已开始处理的图片继续执行/);
    const updated = await gateway.commerce.get(original.id);
    expect(updated.runs[0]!.items.map((item) => item.status)).toEqual([
      "processing",
      "failed",
    ]);
    expect(cancel.mock.calls[0]?.[1]).toMatchObject({
      revision: 1,
      runId: running.runs[0]!.id,
    });
    expect(screen.queryByRole("button", { name: "取消未派发图片" })).toBeNull();
    release.forEach((resolve) => resolve());
  });
  it("validates the actual edited template before calling save", async () => {
    const gateway = createTestGateway();
    const original = await createPlan(gateway, 1);
    const save = vi.spyOn(gateway.commerce, "save");
    render(
      <Card
        initial={{ ...original, templateId: "retired-template" }}
        gateway={gateway}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "修改第 1 张" }));
    fireEvent.click(screen.getByRole("button", { name: "保存修改方案" }));
    await screen.findByText("模板不可用。");
    expect(save).not.toHaveBeenCalled();
  });

  it("shows per-role compiled-length feedback without truncating user fields or sending an invalid save", async () => {
    const gateway = createTestGateway();
    const original = await createPlan(gateway, 1);
    const save = vi.spyOn(gateway.commerce, "save");
    const long = {
      ...original,
      brief: {
        ...original.brief,
        facts: "实".repeat(4000),
        sellingPoints: "卖".repeat(2000),
      },
      slots: original.slots.map((slot) => ({
        ...slot,
        instruction: "要".repeat(2000),
        exactText: "字".repeat(1000),
      })),
    };
    render(<Card initial={long} gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "修改第 1 张" }));
    fireEvent.click(screen.getByRole("button", { name: "保存修改方案" }));
    await screen.findByText(/商品主图.*合计过长.*8000/);
    expect(screen.getByLabelText("第 1 张要求")).toHaveValue("要".repeat(2000));
    expect(screen.getByLabelText("第 1 张文案")).toHaveValue("字".repeat(1000));
    expect(save).not.toHaveBeenCalled();
  });
  it("review: commerce uses explicit five-slot confirmation and new conversations retain ordinary image creation", async () => {
    const gateway = createTestGateway(CapturingGateway);
    const task = await createPlan(gateway, 5);
    const submit = vi.spyOn(gateway.commerce, "submit");
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByTestId("commerce-task");
    fireEvent.click(await screen.findByRole("button", { name: "测试商品套图" }));
    await screen.findByTestId("commerce-task");
    // Task loading notifies the parent composer mode through an effect.
    await waitFor(() => expect(
      screen.queryByRole("textbox", { name: "创作输入" }),
    ).not.toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: "在对话中修改此任务" }),
    ).not.toBeInTheDocument();
    expect(gateway.lastImageRequest).toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认生成 5 张" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]?.[1]).toMatchObject({
      revision: task.revision,
      slotIds: task.slots.map((slot) => slot.id),
    });
    fireEvent.click(screen.getByRole("button", { name: "新对话" }));
    await screen.findByRole("textbox", { name: "创作输入" });
    fireEvent.click(screen.getByRole("button", { name: "创建图片" }));
    fireEvent.change(screen.getByRole("textbox", { name: "创作输入" }), {
      target: { value: "生成一张月球风景图" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送创作请求" }));
    await waitFor(() => expect(gateway.lastImageRequest).toBeDefined());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("review: dirty edits block old confirmation and saving selects only the edited slot at the new revision", async () => {
    const gateway = createTestGateway();
    const task = await createPlan(gateway, 5);
    const submit = vi.spyOn(gateway.commerce, "submit");
    const save = vi.spyOn(gateway.commerce, "save");
    render(<Card initial={task} gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "修改第 3 张" }));
    fireEvent.change(screen.getByLabelText("第 3 张文案"), {
      target: { value: "保留的准确文案" },
    });
    const oldConfirm = screen.getByRole("button", { name: "确认生成 5 张" });
    expect(oldConfirm).toBeDisabled();
    fireEvent.click(oldConfirm);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存修改方案" }));
    const nextConfirm = await screen.findByRole("button", {
      name: "确认生成 1 张",
    });
    fireEvent.click(nextConfirm);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[1].plan.slots[2]?.exactText).toBe(
      "保留的准确文案",
    );
    expect(submit.mock.calls[0]?.[1]).toMatchObject({
      revision: 2,
      slotIds: [task.slots[2]!.id],
    });
  });

  it("review: definitive conflict during recovery unlocks editing and persists rejection while preserving the replay identity", async () => {
    const gateway = createTestGateway();
    const task = await createPlan(gateway, 1);
    const submit = vi.spyOn(gateway.commerce, "submit").mockRejectedValueOnce(
      new WorkspaceError({
        code: "NETWORK",
        message: "请求尚未到达服务端",
        retryable: true,
      }),
    );
    render(<Card initial={task} gateway={gateway} />);
    fireEvent.click(screen.getByRole("button", { name: "确认生成 1 张" }));
    await screen.findByText("请求尚未到达服务端");
    expect(screen.getByRole("button", { name: "修改第 1 张" })).toBeDisabled();
    await gateway.commerce.save(task.id, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      plan: {
        ...task,
        brief: { ...task.brief, facts: "另一标签页确认的事实" },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复原提交" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "修改第 1 张" })).toBeEnabled(),
    );
    expect(submit.mock.calls[1]?.[1]).toEqual(submit.mock.calls[0]?.[1]);
    expect(
      JSON.parse(sessionStorage.getItem(`zimage-commerce-submit:${task.id}`)!),
    ).toMatchObject({
      rejected: true,
      requestId: submit.mock.calls[0]?.[1].requestId,
    });
    expect((await gateway.commerce.get(task.id)).runs).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "修改第 1 张" }));
    fireEvent.change(screen.getByLabelText("第 1 张文案"), {
      target: { value: "修订后的文案" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改方案" }));
    await screen.findByText(/修改方案已保存/);
    fireEvent.click(screen.getByRole("button", { name: "确认生成 1 张" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
    expect(submit.mock.calls[2]?.[1].revision).toBe(3);
    expect(submit.mock.calls[2]?.[1].requestId).not.toBe(
      submit.mock.calls[0]?.[1].requestId,
    );
  });

  it("review: saved-task draft survives switching sessions and edits image requirements without losing manual text", async () => {
    const gateway = createTestGateway();
    await gateway.createSession("另一个会话");
    await createPlan(gateway, 3);
    render(<UnifiedWorkspace gateway={gateway} />);
    await screen.findByTestId("commerce-task");
    fireEvent.click(await screen.findByRole("button", { name: "测试商品套图" }));
    await screen.findByTestId("commerce-task");
    fireEvent.click(screen.getByRole("button", { name: "修改第 3 张" }));
    fireEvent.change(screen.getByLabelText("第 3 张文案"), {
      target: { value: "未保存的准确文案" },
    });
    fireEvent.click(screen.getByRole("button", { name: "另一个会话" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "修改分图方案" })).toBeNull(),
    );
    // Target the visible ordinary sidebar; jsdom does not apply the closed drawer CSS.
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "测试商品套图" }));
    await screen.findByRole("dialog", { name: "修改分图方案" });
    expect(screen.getByLabelText("第 3 张文案")).toHaveValue(
      "未保存的准确文案",
    );
    expect(
      screen.queryByRole("textbox", { name: "创作输入" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("第 3 张要求"), {
      target: { value: "第三张背景换成米色" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("第 3 张要求")).toHaveValue(
        "第三张背景换成米色",
      ),
    );
    expect(screen.getByLabelText("第 3 张文案")).toHaveValue(
      "未保存的准确文案",
    );
  });

  it("review: replacing shared product references invalidates compiled plans and only saves newly prepared references", async () => {
    const gateway = createTestGateway();
    const session = await gateway.createSession("素材替换");
    const create = vi.spyOn(gateway.commerce, "create");
    const upload = vi.spyOn(gateway.commerce, "upload");
    const reference = (name: string): UploadReference => ({
      file: new File([name], name, { type: "image/png" }),
      name,
      previewUrl: `blob:${name}`,
      mimeType: "image/png",
      size: name.length,
      status: "ready",
    });
    function Wizard() {
      const [references, setReferences] = useState([reference("A.png")]);
      return (
        <>
          <button onClick={() => setReferences([reference("B.png")])}>
            替换商品
          </button>
          <CommerceWizard
            scene="product-set"
            sessionId={session.id}
            gateway={gateway.commerce}
            references={references}
            capabilities={IMAGE_PROVIDER_CAPABILITIES}
            settings={{
              provider: "seedream",
              model: "doubao-seedream-5.0-pro",
              aspectRatio: "1:1",
              resolution: "2K",
            }}
            onReferenceAdd={() => undefined}
            onReferenceRemove={() => undefined}
            onReferenceUploaded={(file, id) =>
              setReferences((current) =>
                current.map((item) => (item === file ? { ...item, id } : item)),
              )
            }
            onSaved={() => undefined}
            onClose={() => undefined}
          />
        </>
      );
    }
    render(<Wizard />);
    fireEvent.change(screen.getByLabelText("商品描述"), {
      target: { value: "杯子" },
    });
    fireEvent.click(screen.getByRole("button", { name: "替换商品" }));
    expect(
      screen.getByRole("button", { name: "保存草稿" }),
    ).toBeEnabled();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: "保存草稿" }),
    );
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const b = await upload.mock.results[0]!.value;
    expect(create.mock.calls[0]?.[0].plan.brief.productReferenceIds).toEqual([
      b,
    ]);
    expect(
      create.mock.calls[0]?.[0].plan.slots.every(
        (slot) =>
          slot.referenceIds.includes(b),
      ),
    ).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("preserves historical per-slot requirements when the simplified form changes product requirements and counts", async () => {
    const gateway = createTestGateway();
    const task = await createPlan(gateway, 3);
    const create = vi.spyOn(gateway.commerce, "create");
    render(
      <CommerceWizard
        seedPlan={{ ...task, slots: task.slots.map((slot, index) => ({ ...slot, instruction: index === 2 ? "第三张单独使用绿色" : "" })) }}
        scene="product-set"
        sessionId={task.sessionId}
        gateway={gateway.commerce}
        references={[
          {
            id: task.brief.productReferenceIds[0]!,
            name: "商品.png",
            mimeType: "image/png",
            size: 1,
            status: "ready",
          },
        ]}
        capabilities={IMAGE_PROVIDER_CAPABILITIES}
        settings={{
          provider: "seedream",
          model: "doubao-seedream-5.0-pro",
          aspectRatio: "1:1",
          resolution: "2K",
        }}
        onReferenceAdd={() => undefined}
        onReferenceRemove={() => undefined}
        onReferenceUploaded={() => undefined}
        onSaved={() => undefined}
        onClose={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("商品描述"), { target: { value: "陶瓷杯，暖色背景。" } });
    fireEvent.change(screen.getByLabelText("scene图片数量"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("other图片数量"), { target: { value: "0" } });
    expect(screen.queryByRole("button", { name: "调整分图方案" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(
      create.mock.calls[0]?.[0].plan.slots.map((slot) => slot.instruction),
    ).toEqual(["", "", "第三张单独使用绿色", ""]);
    expect(create.mock.calls[0]?.[0].plan.brief.description).toBe("陶瓷杯，暖色背景。");
  });
});
