import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const spies = vi.hoisted(() => ({
  calls: 0,
  fail: false,
  healthFail: false,
  historyFail: false,
  beforeHealthFailure: undefined as (() => void) | undefined,
  beforeHistoryFailure: undefined as (() => void) | undefined,
}));
vi.mock("@/server/preview/preview-usage-guard", () => ({
  createPreviewUsageGuard: () => ({}),
  withPreviewUsageReservation: async (
    _a: unknown,
    _b: unknown,
    fn: () => Promise<unknown>,
  ) => fn(),
}));
vi.mock("@/server/chat/chat-providers", () => ({
  resolveChatProvider: () => ({}),
  ChatProviderFailure: class extends Error {},
  streamOpenAiCompatibleChat: async function* () {
    spies.calls++;
    if (spies.fail) throw Error("network unknown");
    yield "saved reply";
  },
}));
import { billedChat } from "@/server/credits/billed-text";
function fixture() {
  const requestId = crypto.randomUUID(),
    sessionId = crypto.randomUUID(),
    messageId = crypto.randomUUID();
  let op: Record<string, unknown> | undefined;
  let checkpointFailure = false;
  const rpc = vi.fn(
    async (
      _name: string,
      args: Record<string, unknown>,
    ) => {
      if (_name === "assert_chat_provider_available") {
        if (spies.healthFail) {
          spies.beforeHealthFailure?.();
          return { data: null, error: { message: "health unavailable" } };
        }
        return { data: true, error: null };
      }
      if (_name === "record_chat_provider_result")
        return { data: null, error: null };
      const action = args.p_action;
      const input = args.p_input as Record<string, unknown>;
      if (action === "text_start") {
        op ??= {
          id: crypto.randomUUID(),
          status: "reserved",
          session_id: sessionId,
          result: null,
          started: {
            created: false,
            session: {
              id: sessionId,
              status: "active",
              title: "test",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        };
      } else if (action === "text_claim") {
        if (op!.status !== "reserved")
          return { data: { claimed: false }, error: null };
        op!.status = "processing";
        return { data: { claimed: true }, error: null };
      } else if (action === "text_result") {
        op!.result = input.result;
        op!.status = "result";
      } else if (action === "text_complete") {
        if (checkpointFailure) {
          checkpointFailure = false;
          return { data: null, error: { message: "storage unavailable" } };
        }
        op!.status = "succeeded";
        op!.result = { ...(op!.result as object), messageId };
      } else if (action === "text_unknown" && op!.status !== "result")
        op!.status = "needs_review";
      else if (action === "text_refund" || (action === "text_cancel" && op!.status === "reserved")) op!.status = "refunded";
      return { data: structuredClone(op), error: null };
    },
  );
  // Keep SupabaseChatStore real; only the database query boundary is simulated.
  const historyQuery = {
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(async () => {
      if (spies.historyFail) {
        spies.beforeHistoryFailure?.();
        return { data: null, error: { message: "history unavailable" } };
      }
      return { data: [], error: null };
    }),
  };
  historyQuery.select.mockReturnValue(historyQuery);
  historyQuery.eq.mockReturnValue(historyQuery);
  historyQuery.order.mockReturnValue(historyQuery);
  const from = vi.fn().mockReturnValue(historyQuery);
  return {
    admin: { rpc, from } as unknown as SupabaseClient,
    rpc,
    input: {
      requestId,
      sessionId,
      message: "hello",
      chatModel: "doubao" as const,
      billing: { version: "2026-10-12.1", totalMinor: 2 },
    },
    user: crypto.randomUUID(),
    op: () => op,
    failComplete: () => {
      checkpointFailure = true;
    },
  };
}
async function run(f: ReturnType<typeof fixture>) {
  const response = await billedChat(
    f.admin,
    f.user,
    f.input,
    new Request("http://localhost/api/chat"),
    crypto.randomUUID(),
  );
  return response.text();
}
describe("billed text recovery", () => {
  it("does not refund another retry's claimed call when this retry fails preflight", async () => {
    const f = fixture();
    spies.healthFail = true;
    spies.beforeHealthFailure = () => { f.op()!.status = 'processing'; };
    await expect(run(f)).rejects.toMatchObject({code:'billing_pending'});
    expect(f.op()?.status).toBe('processing');
    expect(spies.calls).toBe(0);
    expect(f.rpc.mock.calls.some(([,args]) => args.p_action === 'text_refund')).toBe(false);
  });
  beforeEach(() => {
    spies.calls = 0;
    spies.fail = false;
    spies.healthFail = false;
    spies.historyFail = false;
    spies.beforeHealthFailure = undefined;
    spies.beforeHistoryFailure = undefined;
  });
  it("replays saved result without calling a now unavailable model", async () => {
    const f = fixture();
    expect(await run(f)).toContain("message.completed");
    spies.healthFail = true;
    expect(await run(f)).toContain("message.completed");
    expect(spies.calls).toBe(1);
  });
  it("only finishes saving and settling on checkpoint recovery", async () => {
    const f = fixture();
    f.failComplete();
    expect(await run(f)).toContain("stream.failed");
    expect(f.op()?.status).toBe("result");
    expect(await run(f)).toContain("message.completed");
    expect(spies.calls).toBe(1);
  });
  it("holds ambiguous provider outcome and never replays it", async () => {
    const f = fixture();
    spies.fail = true;
    expect(await run(f)).toContain("stream.failed");
    expect(f.op()?.status).toBe("needs_review");
    await expect(run(f)).rejects.toMatchObject({ code: "billing_pending" });
    expect(spies.calls).toBe(1);
  });
  it("refunds preflight rejection without calling upstream", async () => {
    const f = fixture();
    spies.healthFail = true;
    await expect(run(f)).rejects.toThrow();
    expect(f.op()?.status).toBe("refunded");
    expect(spies.calls).toBe(0);
  });
  it("cancels an unclaimed request when history loading fails", async () => {
    const f = fixture();
    spies.historyFail = true;
    await expect(run(f)).rejects.toMatchObject({
      code: "provider_error",
      status: 503,
      retryable: false,
    });
    expect(f.op()?.status).toBe("refunded");
    expect(spies.calls).toBe(0);
    expect(f.rpc.mock.calls.filter(([, args]) => args.p_action === "text_cancel")).toHaveLength(1);
    expect(f.rpc.mock.calls.some(([, args]) => args.p_action === "text_claim" || args.p_action === "text_refund")).toBe(false);
  });
  it("does not refund another retry's claimed call when history loading fails", async () => {
    const f = fixture();
    spies.historyFail = true;
    spies.beforeHistoryFailure = () => { f.op()!.status = "processing"; };
    await expect(run(f)).rejects.toMatchObject({ code: "billing_pending" });
    expect(f.op()?.status).toBe("processing");
    expect(spies.calls).toBe(0);
    expect(f.rpc.mock.calls.filter(([, args]) => args.p_action === "text_cancel")).toHaveLength(1);
    expect(f.rpc.mock.calls.some(([, args]) => args.p_action === "text_refund")).toBe(false);
  });
  it("never calls upstream when replaying a request cancelled after a history failure", async () => {
    const f = fixture();
    spies.historyFail = true;
    await expect(run(f)).rejects.toMatchObject({ code: "provider_error", status: 503 });
    spies.historyFail = false;
    await expect(run(f)).rejects.toMatchObject({ code: "provider_error", status: 409 });
    expect(f.op()?.status).toBe("refunded");
    expect(spies.calls).toBe(0);
    expect(f.rpc.mock.calls.filter(([, args]) => args.p_action === "text_cancel")).toHaveLength(1);
    expect(f.rpc.mock.calls.some(([, args]) => args.p_action === "text_claim")).toBe(false);
  });
});
