import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const spies = vi.hoisted(() => ({ calls: 0, fail: false, healthFail: false, beforeHealthFailure: undefined as (() => void) | undefined }));
vi.mock("@/server/preview/preview-usage-guard", () => ({
  createPreviewUsageGuard: () => ({}),
  withPreviewUsageReservation: async (
    _a: unknown,
    _b: unknown,
    fn: () => Promise<unknown>,
  ) => fn(),
}));
vi.mock("@/server/chat/supabase-chat-store", () => ({
  SupabaseChatStore: class {
    async assertProviderAvailable() {
      if (spies.healthFail) { spies.beforeHealthFailure?.(); throw Error("unavailable"); }
    }
    async history() {
      return [];
    }
    async recordProviderResult() {}
  },
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
      args: { p_action: string; p_input: Record<string, unknown> },
    ) => {
      const action = args.p_action;
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
        op!.result = args.p_input.result;
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
  return {
    admin: { rpc } as unknown as SupabaseClient,
    rpc,
    input: {
      requestId,
      sessionId,
      message: "hello",
      chatModel: "doubao" as const,
      billing: { version: "2026-09-15.1", totalMinor: 2 },
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
    spies.beforeHealthFailure = undefined;
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
});
