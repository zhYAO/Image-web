import { describe, it, expect, vi } from "vitest";
import {
  initialMockCredits,
  reserveMockCredits,
  settleMockCredits,
  checkMockQuote,
} from "@/gateways/mock-credit-ledger";
import { creditFailure, readCredits } from "@/server/credits/credit-service";
import { imageCreditItem } from "@zimage/domain";
import { createCommerceService } from "@/server/commerce/commerce-service";
describe("credit accounting boundaries", () => {
  it("settles partial image failure once and conserves the gift", () => {
    const state = initialMockCredits();
    const item = imageCreditItem({
      provider: "seedream",
      resolution: "2K",
      count: 1,
    });
    reserveMockCredits(state, "first", "first", item);
    reserveMockCredits(state, "second", "second", item);
    reserveMockCredits(state, "first", "first", item);
    expect(state.wallet).toEqual({
      availableMinor: 940,
      frozenMinor: 60,
      spentMinor: 0,
    });
    settleMockCredits(state, "first", true);
    settleMockCredits(state, "second", false);
    settleMockCredits(state, "second", false);
    expect(state.wallet).toEqual({
      availableMinor: 970,
      frozenMinor: 0,
      spentMinor: 30,
    });
    expect(state.ledger.filter((l) => l.kind === "release")).toHaveLength(1);
  });
  it("rejects altered idempotency content and prices", () => {
    const s = initialMockCredits();
    const item = imageCreditItem({
      provider: "gemini",
      resolution: "2K",
      count: 1,
    });
    reserveMockCredits(s, "r", "a", item);
    expect(() => reserveMockCredits(s, "r", "b", item)).toThrow();
    expect(() =>
      checkMockQuote([item], { version: "2026-09-15.1", totalMinor: 1 }),
    ).toThrow();
  });
  it("keeps credits, image quota, stale price and unknown errors distinct", () => {
    expect(creditFailure({ message: "insufficient_credits" }).code).toBe(
      "insufficient_credits",
    );
    expect(creditFailure({ message: "quota_exceeded" }).code).toBe(
      "quota_exceeded",
    );
    expect(creditFailure({ message: "credit_price_changed" }).code).toBe(
      "price_changed",
    );
    expect(creditFailure({ message: "credit_result_pending" }).code).toBe(
      "billing_pending",
    );
  });
  it("passes authenticated identity to the only billing RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { availableMinor: 1000, frozenMinor: 0, spentMinor: 0 },
      error: null,
    });
    await readCredits({ rpc }, "owner");
    expect(rpc).toHaveBeenCalledWith("credit_dispatch", {
      p_user_id: "owner",
      p_action: "wallet",
      p_input: {},
    });
  });
  it("reports missing poster migration before writing a valid content plan", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const user = crypto.randomUUID();
    await expect(
      createCommerceService({ rpc }).dispatch(
        user,
        "create",
        undefined,
        {
          requestId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          plan: {
            scene: "xhs-poster",
            templateId: "xhs-editorial",
            brief: {
              contentMode: "content",
              name: "标题",
              facts: "正文",
              sellingPoints: "",
              platform: "xiaohongshu",
              placement: "封面",
              productReferenceIds: [],
              styleReferenceIds: [],
            },
            slots: [
              {
                id: crypto.randomUUID(),
                role: "封面",
                instruction: "",
                exactText: "标题",
                referenceIds: [],
                provider: "seedream",
                model: "seedream-4.5",
                aspectRatio: "3:4",
                resolution: "2K",
              },
            ],
          },
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "service_not_ready", status: 503 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("mock billing transactions", () => {
  it("serializes a paid chat behind a commerce rollback", async () => {
    const { MockWorkspaceGateway } =
      await import("@/gateways/mock-workspace-gateway");
    const values = new Map<string, string>();
    const gateway = new MockWorkspaceGateway({
      delay: async () => {},
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
      },
    });
    const session = await gateway.createSession("billing test");
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const transaction = gateway
      .runCommerceTransaction(async () => {
        entered();
        await blocked;
        throw Error("rollback");
      })
      .catch(() => undefined);
    await started;
    const stream = gateway
      .streamChat({
        imageToolEnabled: false,
        requestId: crypto.randomUUID(),
        sessionId: session.id,
        message: "hello",
        chatModel: "doubao",
        billing: { version: "2026-09-15.1", totalMinor: 2 },
      })
      [Symbol.asyncIterator]();
    const first = stream.next();
    release();
    await transaction;
    await first;
    while (!(await stream.next()).done) {}
    expect(await gateway.getCreditWallet()).toEqual({
      availableMinor: 998,
      frozenMinor: 0,
      spentMinor: 2,
    });
  });
  it("never charges a chat against a missing session", async () => {
    const { MockWorkspaceGateway } =
      await import("@/gateways/mock-workspace-gateway");
    const gateway = new MockWorkspaceGateway({
      delay: async () => {},
      storage: { getItem: () => null, setItem: () => {} },
    });
    const stream = gateway
      .streamChat({
        imageToolEnabled: false,
        requestId: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        message: "hello",
        billing: { version: "2026-09-15.1", totalMinor: 2 },
      })
      [Symbol.asyncIterator]();
    await expect(stream.next()).rejects.toThrow();
    expect((await gateway.getCreditWallet()).availableMinor).toBe(1000);
  });
});
