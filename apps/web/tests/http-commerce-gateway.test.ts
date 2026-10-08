import { buildCommerceSlots } from "@zimage/domain";
import { describe, expect, it, vi } from "vitest";
import { HttpWorkspaceGateway } from "@/gateways/http-workspace-gateway";
const settings = {
  provider: "seedream",
  model: "seedream-5.0-flash",
  aspectRatio: "1:1" as const,
  resolution: "2K" as const,
};
const brief = {
  name: "杯子",
  facts: "白色",
  sellingPoints: "",
  platform: "taobao" as const,
  placement: "商品展示",
  productReferenceIds: [crypto.randomUUID()],
  styleReferenceIds: [],
};
const task = {
  id: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  scene: "product-set",
  revision: 1,
  templateId: "soft-studio",
  brief,
  slots: buildCommerceSlots(brief, "product-set", 3, settings),
  createdAt: "2026-09-08T00:00:00Z",
  updatedAt: "2026-09-08T00:00:00Z",
  runs: [],
  selections: [],
};
describe("HTTP commerce contract", () => {
  it("submits one atomic group and preserves the exact request id, revision and selections on retry", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(Response.json(task));
    const gateway = new HttpWorkspaceGateway({ fetcher });
    const input = {
      requestId: crypto.randomUUID(),
      revision: 1,
      slotIds: task.slots.map((s) => s.id),
    };
    await expect(gateway.commerce.submit(task.id, input)).rejects.toThrow();
    await gateway.commerce.submit(task.id, input);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![0]).toBe(
      `/api/creative-tasks/${task.id}/submit`,
    );
    expect(fetcher.mock.calls[0]![1]!.body).toBe(
      fetcher.mock.calls[1]![1]!.body,
    );
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual(
      input,
    );
  });
  it("returns an immutable export selection even if signing an expired asset fails", async () => {
    const generationId = crypto.randomUUID(),
      slotId = task.slots[0]!.id;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          id: crypto.randomUUID(),
          revision: 1,
          createdAt: task.createdAt,
          items: [{ slotId, generationId }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "asset_expired",
            message: "已过期",
            retryable: false,
            correlationId: crypto.randomUUID(),
          },
          { status: 410 },
        ),
      );
    const gateway = new HttpWorkspaceGateway({ fetcher });
    const result = await gateway.commerce.export(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      selections: [{ slotId, generationId }],
    });
    expect(result.items).toEqual([{ slotId, generationId, expired: true }]);
  });
  it("leaves status reads unsigned and signs only an explicitly opened image", async () => {
    const generationId = crypto.randomUUID(),
      slotId = task.slots[0]!.id;
    const completed = {
      ...task,
      runs: [
        {
          id: crypto.randomUUID(),
          revision: 1,
          requestId: crypto.randomUUID(),
          createdAt: task.createdAt,
          items: [
            {
              slotId,
              generationId,
              batchId: crypto.randomUUID(),
              status: "succeeded",
              compatibilityHash: "h",
              selectionVersion: 0,
            },
          ],
        },
      ],
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (String(path).endsWith("/asset-url"))
        return Response.json({
          generationId,
          url: "https://example.com/image.png",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
      if (String(path).endsWith("/export"))
        return Response.json({
          id: crypto.randomUUID(),
          revision: 1,
          createdAt: task.createdAt,
          items: [{ slotId, generationId }],
        });
      return Response.json(completed);
    });
    const gateway = new HttpWorkspaceGateway({ fetcher });
    await gateway.commerce.get(task.id);
    await gateway.commerce.get(task.id);
    expect(
      fetcher.mock.calls.filter(([path]) =>
        String(path).endsWith("/asset-url"),
      ),
    ).toHaveLength(0);
    await gateway.commerce.assetUrl?.(generationId);
    await gateway.commerce.assetUrl?.(generationId);
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/asset-url'))).toHaveLength(1);
    await gateway.commerce.export(task.id, {
      requestId: crypto.randomUUID(),
      revision: 1,
      selections: [{ slotId, generationId }],
    });
    expect(
      fetcher.mock.calls.filter(([path]) =>
        String(path).endsWith("/asset-url"),
      ),
    ).toHaveLength(2);
  });
  it('joins concurrent explicit renewals for the same image', async () => {
    const generationId = crypto.randomUUID();
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(done => { resolve = done; }));
    const gateway = new HttpWorkspaceGateway({ fetcher });
    const first = gateway.commerce.assetUrl?.(generationId, true);
    const second = gateway.commerce.assetUrl?.(generationId, true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(Response.json({ generationId, url: 'https://example.com/image.png',
      expiresAt: new Date(Date.now() + 300_000).toISOString() }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { url: 'https://example.com/image.png', expired: false },
      { url: 'https://example.com/image.png', expired: false },
    ]);
  });
  it('shares and caches signed original references until the account changes', async () => {
    const referenceId = crypto.randomUUID();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
      url: 'https://example.com/original.png', expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }));
    const gateway = new HttpWorkspaceGateway({ fetcher });
    const result = await Promise.all([
      gateway.commerce.referenceUrl?.(referenceId), gateway.commerce.referenceUrl?.(referenceId),
    ]);
    expect(result[0]?.url).toBe('https://example.com/original.png');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await gateway.commerce.referenceUrl?.(referenceId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    gateway.clearAssetCaches();
    await gateway.commerce.referenceUrl?.(referenceId);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("uploads through the existing protected upload API without sending object URLs", async () => {
    const id = crypto.randomUUID();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        id,
        name: "p.png",
        mimeType: "image/png",
        size: 3,
        width: 1,
        height: 1,
        expiresAt: "2026-10-08T00:00:00Z",
      }),
    );
    const gateway = new HttpWorkspaceGateway({ fetcher });
    await gateway.commerce.upload(task.sessionId, {
      file: new File(["abc"], "p.png", { type: "image/png" }),
      name: "p.png",
      mimeType: "image/png",
      size: 3,
      previewUrl: "blob:local-only",
    });
    const body = fetcher.mock.calls[0]![1]!.body as FormData;
    expect(fetcher.mock.calls[0]![0]).toBe("/api/uploads");
    expect(body.get("sessionId")).toBe(task.sessionId);
    expect(body.has("previewUrl")).toBe(false);
  });
});
