import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/creative-tasks/[id]/download/route";
import { GET } from "@/app/api/creative-tasks/[id]/assets/[assetId]/route";
import { apparelIds } from "./apparel-fixtures";
const boundary = vi.hoisted(() => ({ rpc: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async () => ({
      data: "00000000-0000-4000-8000-000000000001",
      error: null,
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: boundary.rpc,
    storage: { from: () => ({ download: boundary.download, upload: vi.fn() }) },
  }),
}));
describe("private apparel ZIP and preview routes", () => {
  beforeEach(() => vi.clearAllMocks());
  const asset = {
    id: apparelIds[1],
    name: "主图/1.jpg",
    kind: "layout",
    width: 750,
    height: 1000,
    mimeType: "image/jpeg",
    expiresAt: "2099-01-01",
    expired: false,
  };
  const bytes = new Uint8Array([255, 216, 1, 2, 3, 255, 217]);
  it("streams original JPEG bytes and preserves UTF-8 directories without model calls", async () => {
    boundary.rpc.mockImplementation(async (_name, args) => ({
      data:
        args.p_operation === "export"
          ? { runId: apparelIds[0], items: [asset] }
          : { path: "private/result.jpg", name: asset.name },
      error: null,
    }));
    boundary.download.mockResolvedValue({
      data: { arrayBuffer: async () => bytes },
      error: null,
    });
    const response = await POST(
      new Request(
        `http://localhost/api/creative-tasks/${apparelIds[7]}/download?engine=apparel-catalog`,
        {
          method: "POST",
          headers: {
            origin: "http://localhost",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            requestId: apparelIds[2],
            revision: 1,
            runId: apparelIds[0],
          }),
        },
      ),
      { params: Promise.resolve({ id: apparelIds[7]! }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const zip = new Uint8Array(await response.arrayBuffer()),
      view = new DataView(zip.buffer),
      nameLength = view.getUint16(26, true);
    expect(view.getUint16(8, true)).toBe(0);
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLength))).toBe(
      "主图/1.jpg",
    );
    expect(zip.slice(30 + nameLength, 30 + nameLength + bytes.length)).toEqual(
      bytes,
    );
    expect(
      boundary.rpc.mock.calls.every((call) => call[0] === "apparel_dispatch"),
    ).toBe(true);
  });
  it("returns private no-store previews and denies expired or foreign assets", async () => {
    boundary.rpc.mockResolvedValueOnce({
      data: { path: "private/result.jpg", name: asset.name },
      error: null,
    });
    boundary.download.mockResolvedValue({
      data: { arrayBuffer: async () => bytes },
      error: null,
    });
    const context = {
      params: Promise.resolve({ id: apparelIds[7]!, assetId: apparelIds[1]! }),
    };
    const response = await GET(new Request("http://localhost/"), context);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    boundary.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "asset_expired" },
    });
    expect((await GET(new Request("http://localhost/"), context)).status).toBe(
      410,
    );
    boundary.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "task_not_found" },
    });
    expect((await GET(new Request("http://localhost/"), context)).status).toBe(
      404,
    );
    expect(boundary.download).toHaveBeenCalledTimes(1);
  });
});
