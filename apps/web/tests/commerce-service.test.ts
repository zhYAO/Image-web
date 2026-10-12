import { describe, expect, it, vi } from "vitest";
import { buildCommerceSlots } from "@zimage/domain";
import { createCommerceService } from "@/server/commerce/commerce-service";
const userId = crypto.randomUUID(),
  sessionId = crypto.randomUUID();
const brief = {
  name: "陶瓷杯",
  facts: "白色",
  sellingPoints: "",
  platform: "taobao" as const,
  placement: "商品展示",
  productReferenceIds: [],
  styleReferenceIds: [],
};
const settings = {
  provider: "seedream",
  model: "doubao-seedream-5.0-pro",
  aspectRatio: "1:1" as const,
  resolution: "2K" as const,
};
const plan = {
  scene: "product-set" as const,
  brief,
  templateId: "soft-studio",
  slots: buildCommerceSlots(brief, "product-set", 2, settings),
};
describe("trusted commerce service", () => {
  it('applies the submit stop switch to direct service calls', async () => {
    vi.stubEnv('ZIMAGE_COMMERCE_SUBMIT_ENABLED', 'false');
    const rpc = vi.fn();
    try {
      await expect(createCommerceService({ rpc }).dispatch(userId, 'submit', crypto.randomUUID(), {
        requestId: crypto.randomUUID(), revision: 1, slotIds: [plan.slots[0]!.id],
      }, crypto.randomUUID())).rejects.toMatchObject({ status: 503 });
      expect(rpc).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it("reads a historical 4.5 plan but requires an explicit upgrade before saving a new revision", async () => {
    const legacy={...plan,slots:plan.slots.map(slot=>({...slot,model:'seedream-4.5'})),id:crypto.randomUUID(),sessionId,revision:1,createdAt:'now',updatedAt:'now',runs:[],selections:[]};
    const rpc=vi.fn().mockResolvedValueOnce({data:legacy,error:null}).mockResolvedValueOnce({data:null,error:null});
    expect(await createCommerceService({rpc}).dispatch(userId,'get',legacy.id,{},crypto.randomUUID())).toMatchObject({slots:legacy.slots});
    await expect(createCommerceService({rpc}).dispatch(userId,'save',legacy.id,{requestId:crypto.randomUUID(),expectedRevision:1,plan:legacy},crypto.randomUUID())).rejects.toThrow("所选图片模型已停止新生成，请主动更新为 Seedream 5.0 Pro 并保存新版本。");
    expect(rpc.mock.calls).toHaveLength(2);
  });

  it("retains the content poster input and reports an unavailable database capability before any write", async () => {
    const posterBrief = { ...brief, name: '穿搭笔记', facts: '白色连衣裙搭配建议', contentMode: 'content' as const, platform: 'xiaohongshu' as const };
    const poster = { ...plan, scene: 'xhs-poster' as const, brief: posterBrief, templateId: 'xhs-editorial', slots: buildCommerceSlots(posterBrief, 'xhs-poster', 1, settings) };
    const input = { requestId: crypto.randomUUID(), sessionId, plan: poster };
    const before = structuredClone(input);
    const rpc = vi.fn().mockResolvedValue({data:null,error:{code:'PGRST202'}});
    await expect(createCommerceService({rpc}).dispatch(userId,'create',undefined,input,crypto.randomUUID())).rejects.toMatchObject({code:'service_not_ready',status:503,message:expect.stringContaining('创作服务尚未完成更新')});
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_commerce_capabilities', {});
    expect(input).toEqual(before);
  });
  it("compiles persisted drafts on server without submitting images", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValue({
        data: {
          ...plan,
          id: crypto.randomUUID(),
          sessionId,
          revision: 1,
          createdAt: "now",
          updatedAt: "now",
          runs: [],
          selections: [],
        },
        error: null,
      });
    await createCommerceService({ rpc }).dispatch(
      userId,
      "create",
      undefined,
      { requestId: crypto.randomUUID(), sessionId, plan },
      crypto.randomUUID(),
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    const args = rpc.mock.calls[1]![1];
    expect(args.p_compiled).toHaveLength(2);
    expect(args.p_compiled[0].config.count).toBe(1);
    expect(args.p_compiled[0].prompt).toContain("陶瓷杯");
  });
  it.each([
    ["commerce_slot_active", 409],
    ["commerce_recreate_required", 409],
    ["task_archived", 409],
    ["commerce_generation_unavailable", 410],
    ["commerce_brief_incomplete", 400],
    ["invalid_commerce_plan", 503],
    ["commerce_not_ready", 503],
    ["quota_exceeded", 429],
  ])(
    "maps authoritative %s to a definite user-facing rejection",
    async (message, status) => {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { message } });
      await expect(
        createCommerceService({ rpc }).dispatch(
          userId,
          "submit",
          crypto.randomUUID(),
          {
            requestId: crypto.randomUUID(),
            revision: 1,
            slotIds: [plan.slots[0]!.id],
          },
          crypto.randomUUID(),
        ),
      ).rejects.toMatchObject({ status });
    },
  );
  it("preserves cancel run identity at the atomic boundary", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...plan,
        id: crypto.randomUUID(),
        sessionId,
        revision: 1,
        createdAt: "now",
        updatedAt: "now",
        runs: [],
        selections: [],
      },
      error: null,
    });
    const request = {
      requestId: crypto.randomUUID(),
      revision: 1,
      runId: crypto.randomUUID(),
    };
    await createCommerceService({ rpc }).dispatch(
      userId,
      "cancel",
      crypto.randomUUID(),
      request,
      crypto.randomUUID(),
    );
    expect(rpc.mock.calls[0]![1].p_input).toEqual(request);
  });
  it("rejects an unavailable template before writing", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(
      createCommerceService({ rpc }).dispatch(
        userId,
        "create",
        undefined,
        {
          requestId: crypto.randomUUID(),
          sessionId,
          plan: { ...plan, templateId: "external-injected" },
        },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow();
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]![1].p_compiled).toBeNull();
  });
  it("replays a committed draft even after its template becomes unavailable", async () => {
    const prior = {
      ...plan,
      id: crypto.randomUUID(),
      sessionId,
      revision: 1,
      createdAt: "now",
      updatedAt: "now",
      runs: [],
      selections: [],
    };
    const rpc = vi.fn().mockResolvedValue({ data: prior, error: null });
    const result = await createCommerceService({ rpc }).dispatch(
      userId,
      "create",
      undefined,
      {
        requestId: crypto.randomUUID(),
        sessionId,
        plan: { ...plan, templateId: "retired-template" },
      },
      crypto.randomUUID(),
    );
    expect(result).toMatchObject({ id: prior.id });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]![1].p_compiled).toBeNull();
  });
  it("rejects an overlong compiled slot with actionable feedback before persistence", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const oversized = {
      ...plan,
      brief: {
        ...brief,
        facts: "事".repeat(4000),
        sellingPoints: "卖".repeat(2000),
      },
      slots: [
        {
          ...plan.slots[0]!,
          instruction: "求".repeat(2000),
          exactText: "字".repeat(1000),
        },
      ],
    };
    await expect(
      createCommerceService({ rpc }).dispatch(
        userId,
        "create",
        undefined,
        { requestId: crypto.randomUUID(), sessionId, plan: oversized },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("8000"),
    });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("passes submit identity to atomic store without reading newer revision first", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...plan,
        id: crypto.randomUUID(),
        sessionId,
        revision: 2,
        createdAt: "now",
        updatedAt: "now",
        runs: [],
        selections: [],
      },
      error: null,
    });
    const service = createCommerceService({ rpc });
    const taskId = crypto.randomUUID();
    const request = {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: [plan.slots[0]!.id],
    };
    await service.dispatch(
      userId,
      "submit",
      taskId,
      request,
      crypto.randomUUID(),
    );
    await service.dispatch(
      userId,
      "submit",
      taskId,
      request,
      crypto.randomUUID(),
    );
    expect(rpc.mock.calls.map((c) => c[1].p_operation)).toEqual([
      "submit",
      "submit",
    ]);
    expect(rpc.mock.calls[0]![1].p_request_hash).toBe(
      rpc.mock.calls[1]![1].p_request_hash,
    );
  });
});
