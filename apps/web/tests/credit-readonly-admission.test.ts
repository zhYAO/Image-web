import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRIAL_CREDIT_CATALOG } from "@zimage/domain";

const mocks = vi.hoisted(() => ({
  server: vi.fn(),
  admin: vi.fn(),
  identity: vi.fn(),
  rpc: vi.fn(),
  maintenance: false,
  invalidControl: false,
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/server/observability", () => ({ reportServerError: vi.fn() }));
vi.mock("@/server/lifecycle/request-lifecycle", async original => {
  const actual = await original<typeof import("@/server/lifecycle/request-lifecycle")>();
  const fixture = new actual.RequestLifecycle(() => {
    if (mocks.invalidControl) throw Error("unavailable maintenance control");
    return { schemaVersion: 2, mode: mocks.maintenance ? "draining" : "open", operationId: "fixture-operation" };
  }, () => ({ protocolVersion: 1, barrierId: 'node-http-create-server-v1', installed: true,
    wrappedServerCount: 1, activeHttpRequests: 0, activeFrameworkWork: 0, controlValid: !mocks.invalidControl,
    frameworkWork: { protocolVersion: 1, installed: true, nextVersion: '16.4.1', hook: 'response-cache-revalidate-v1', controlValid: true },
    schemaVersion: 2, admissionEpoch: 'fixture-operation', admissionMode: mocks.maintenance ? 'draining' : 'open' }));
  return {
    ...actual,
    assertMutationAdmission: () => fixture.admission(),
    runTrackedRoute: (handler: () => Promise<Response>) => fixture.route(handler),
    getDrainState: () => fixture.snapshot(),
  };
});

import { GET as wallet } from "@/app/api/credits/route";
import { GET as ledger } from "@/app/api/credits/ledger/route";
import { GET as catalog } from "@/app/api/credits/pricing/route";
import { POST as quote } from "@/app/api/credits/quote/route";
import { readPrices } from "@/server/credits/credit-service";
import { getDrainState } from "@/server/lifecycle/request-lifecycle";

const userId = "10000000-0000-4000-8000-000000000001";
const probeHeader = "x-zimage-readonly-probe";
const walletData = { availableMinor: 1000, frozenMinor: 0, spentMinor: 0 };
const ledgerData = { items: [], nextCursor: null };
const catalogData = { version: "live-prices", enabled: true, prices: [] };
const quoteData = { version: "live-prices", totalMinor: 0, items: [] };
const walletReads = [
  { action: "wallet", run: wallet, path: "/api/credits", data: walletData, input: {} },
  { action: "ledger", run: ledger, path: "/api/credits/ledger?cursor=123", data: ledgerData, input: { cursor: "123" } },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("Headers", new Request("https://app.test").headers.constructor);
  vi.stubEnv("ZIMAGE_CREDITS_ENABLED", "false");
  mocks.maintenance = false;
  mocks.invalidControl = false;
  mocks.identity.mockResolvedValue({ data: userId, error: null });
  mocks.server.mockResolvedValue({ rpc: mocks.identity });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockImplementation(async (_name: string, input: { p_action: "wallet" | "ledger" | "catalog" | "quote" }) => ({
    data: { wallet: walletData, ledger: ledgerData, catalog: catalogData, quote: quoteData }[input.p_action],
    error: null,
  }));
});
afterEach(() => {
  expect(getDrainState().counters.activeMutations).toBe(0);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("wallet reads that can initialize credit state", () => {
  for (const { action, run, path, data, input } of walletReads) {
    it.each([undefined, "catalog-v1"])(`blocks ${action} during maintenance before any SDK or RPC work (probe=%s)`, async probe => {
      mocks.maintenance = true;
      const response = await run(new Request(`https://app.test${path}`, {
        headers: probe ? { [probeHeader]: probe } : {},
      }));
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("30");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get(probeHeader)).toBeNull();
      expect(mocks.server).not.toHaveBeenCalled();
      expect(mocks.admin).not.toHaveBeenCalled();
      expect(mocks.identity).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it.each([undefined, "catalog-v1"])(`fails ${action} closed before SDK work when maintenance control is invalid (probe=%s)`, async probe => {
      mocks.invalidControl = true;
      const response = await run(new Request(`https://app.test${path}`, { headers: probe ? { [probeHeader]: probe } : {} }));
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("30");
      expect(mocks.server).not.toHaveBeenCalled();
      expect(mocks.admin).not.toHaveBeenCalled();
      expect(mocks.identity).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it(`preserves authenticated ${action} reads outside maintenance and ignores a catalog probe header`, async () => {
      const response = await run(new Request(`https://app.test${path}`, { headers: { [probeHeader]: "catalog-v1" } }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(data);
      expect(response.headers.get(probeHeader)).toBeNull();
      expect(mocks.identity).toHaveBeenCalledWith("require_verified_user_id");
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("credit_dispatch", {
        p_user_id: userId, p_action: action, p_input: input,
      });
    });
  }
});

describe("strict read-only catalog probes", () => {
  it.each(["PGRST202", "42883"])("returns 503 instead of the trial fallback when the RPC is missing (%s)", async code => {
    mocks.maintenance = true;
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    const response = await catalog(new Request("https://app.test/api/credits/pricing", { headers: { [probeHeader]: "catalog-v1" } }));
    expect(response.status).toBe(503);
    expect(response.headers.get(probeHeader)).toBeNull();
    expect(await response.json()).toMatchObject({ code: "service_not_ready", retryable: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("credit_dispatch", { p_user_id: userId, p_action: "catalog", p_input: {} });
  });

  it.each([
    { data: null, error: null },
    { data: undefined, error: null },
    { data: null, error: { code: "PGRST000", message: "database unavailable" } },
    { data: null, error: { code: "P0001", message: "insufficient_credits" } },
    { data: { version: "malformed", enabled: true, prices: [{ operation: "invalid" }] }, error: null },
  ])("does not attest an unavailable catalog RPC: %j", async result => {
    mocks.rpc.mockResolvedValue(result);
    const response = await catalog(new Request("https://app.test/api/credits/pricing", { headers: { [probeHeader]: "catalog-v1" } }));
    expect(response.status).toBe(503);
    expect(response.headers.get(probeHeader)).toBeNull();
  });

  it("returns 503 without a marker when the catalog transport rejects", async () => {
    mocks.rpc.mockRejectedValue(Error("transport unavailable"));
    const response = await catalog(new Request("https://app.test/api/credits/pricing", { headers: { [probeHeader]: "catalog-v1" } }));
    expect(response.status).toBe(503);
    expect(response.headers.get(probeHeader)).toBeNull();
  });

  it.each(["false", "true"])("attests an actual catalog RPC during maintenance with credits enabled=%s", async enabled => {
    mocks.maintenance = true;
    vi.stubEnv("ZIMAGE_CREDITS_ENABLED", enabled);
    const response = await catalog(new Request("https://app.test/api/credits/pricing", { headers: { [probeHeader]: "catalog-v1" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: "live-prices", enabled: enabled === "true", prices: [] });
    expect(response.headers.get(probeHeader)).toBe("catalog-v1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("credit_dispatch", { p_user_id: userId, p_action: "catalog", p_input: {} });
  });

  it.each([undefined, "catalog-v2"])("preserves the default UI fallback without attesting it (probe=%s)", async probe => {
    mocks.maintenance = true;
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const response = await catalog(new Request("https://app.test/api/credits/pricing", { headers: probe ? { [probeHeader]: probe } : {} }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...TRIAL_CREDIT_CATALOG, enabled: false });
    expect(response.headers.get(probeHeader)).toBeNull();
  });

  it("does not mark an ordinary successful catalog read", async () => {
    const response = await catalog(new Request("https://app.test/api/credits/pricing"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: "live-prices", enabled: false, prices: [] });
    expect(response.headers.get(probeHeader)).toBeNull();
  });

  it("preserves ordinary catalog schema validation failures", async () => {
    mocks.rpc.mockResolvedValue({ data: { version: "malformed", enabled: true, prices: [{ operation: "invalid" }] }, error: null });
    const response = await catalog(new Request("https://app.test/api/credits/pricing"));
    expect(response.status).toBe(400);
    expect(response.headers.get(probeHeader)).toBeNull();
  });

  it("does not bypass verified identity for a catalog probe", async () => {
    mocks.identity.mockResolvedValue({ data: null, error: { code: "P0001", message: "unauthorized" } });
    const response = await catalog(new Request("https://app.test/api/credits/pricing", { headers: { [probeHeader]: "catalog-v1" } }));
    expect(response.status).toBe(401);
    expect(response.headers.get(probeHeader)).toBeNull();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["PGRST202", "42883"])("allows service callers to opt out of compatibility fallback (%s)", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } });
    await expect(readPrices({ rpc: mocks.rpc }, userId)).resolves.toEqual({ ...TRIAL_CREDIT_CATALOG, enabled: false });
    await expect(readPrices({ rpc: mocks.rpc }, userId, { allowUnavailableFallback: false })).rejects.toMatchObject({ status: 503, code: "service_not_ready" });
  });
});

describe("credit quote POST admission and Origin checks", () => {
  const request = (origin?: string) => new Request("https://app.test/api/credits/quote", {
    method: "POST",
    headers: { "content-type": "application/json", [probeHeader]: "catalog-v1", ...(origin ? { origin } : {}) },
    body: JSON.stringify({ items: [{ operation: "chat", provider: "doubao", model: "doubao", count: 1 }] }),
  });

  it("still blocks a quote during maintenance before SDK work", async () => {
    mocks.maintenance = true;
    const response = await quote(request("https://app.test"));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get(probeHeader)).toBeNull();
    expect(mocks.server).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([undefined, "https://untrusted.test"])("still rejects an untrusted Origin (%s)", async origin => {
    const response = await quote(request(origin));
    expect(response.status).toBe(403);
    expect(response.headers.get(probeHeader)).toBeNull();
    expect(mocks.server).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves ordinary quote dispatch and never marks it as a catalog probe", async () => {
    const response = await quote(request("https://app.test"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(quoteData);
    expect(response.headers.get(probeHeader)).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("credit_dispatch", {
      p_user_id: userId,
      p_action: "quote",
      p_input: { items: [{ operation: "chat", provider: "doubao", model: "doubao", resolution: "", count: 1 }] },
    });
  });
});
