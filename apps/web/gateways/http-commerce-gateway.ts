import { HttpApparelGateway } from './http-apparel-gateway';
import {
  commerceTaskSchema,
  commercePromoteResultSchema,
  commerceExportResultSchema,
  generationAssetUrlResponseSchema,
  referenceUploadResponseSchema,
  WorkspaceError,
  type CommerceGateway,
} from "@zimage/domain";
import { z, type ZodType } from "zod";
type JsonRequest = <T>(
  path: string,
  schema: ZodType<T>,
  init?: RequestInit,
) => Promise<T>;
export class HttpCommerceGateway implements CommerceGateway {
  private readonly assetCache = new Map<
    string,
    { url: string; validUntil: number }
  >();
  private readonly assetRequests = new Map<
    string,
    Promise<{ url?: string; expired: boolean }>
  >();
  private assetEpoch = 0;
  readonly apparel: HttpApparelGateway;
  constructor(private readonly json: JsonRequest, fetcher: typeof fetch = fetch) {
    this.apparel = new HttpApparelGateway(json, (sessionId, reference) => this.upload(sessionId, reference), fetcher);
  }
  async list(sessionId: string) {
    return this.json(`/api/creative-tasks?sessionId=${encodeURIComponent(sessionId)}`,
      z.array(commerceTaskSchema));
  }
  async get(taskId: string) {
    return this.json(`/api/creative-tasks/${taskId}`, commerceTaskSchema);
  }
  async create(input: Parameters<CommerceGateway["create"]>[0]) {
    return this.json("/api/creative-tasks", commerceTaskSchema, {
        method: "POST",
        body: JSON.stringify(input),
      });
  }
  async save(taskId: string, input: Parameters<CommerceGateway["save"]>[1]) {
    return this.json(`/api/creative-tasks/${taskId}`, commerceTaskSchema, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
  }
  async submit(
    taskId: string,
    input: Parameters<CommerceGateway["submit"]>[1],
  ) {
    return this.mutate(taskId, "submit", input);
  }
  async select(
    taskId: string,
    input: Parameters<CommerceGateway["select"]>[1],
  ) {
    return this.mutate(taskId, "select", input);
  }
  async archive(
    taskId: string,
    input: Parameters<CommerceGateway["archive"]>[1],
  ) {
    return this.mutate(taskId, "archive", input);
  }
  async cancel(
    taskId: string,
    input: Parameters<CommerceGateway["cancel"]>[1],
  ) {
    return this.mutate(taskId, "cancel", input);
  }
  private async mutate(taskId: string, operation: string, input: unknown) {
    return this.json(
        `/api/creative-tasks/${taskId}/${operation}`,
        commerceTaskSchema,
        { method: "POST", body: JSON.stringify(input) },
      );
  }
  assetUrl(generationId: string, refresh = false) { return this.asset(generationId, !refresh); }
  clearAssetCache() { this.assetEpoch++; this.assetCache.clear(); this.assetRequests.clear(); }
  async export(
    taskId: string,
    input: Parameters<CommerceGateway["export"]>[1],
  ) {
    const result = await this.json(
      `/api/creative-tasks/${taskId}/export`,
      commerceExportResultSchema,
      { method: "POST", body: JSON.stringify(input) },
    );
    return {
      ...result,
      items: await Promise.all(
        result.items.map(async (item) => ({
          ...item,
          ...(await this.asset(item.generationId)),
        })),
      ),
    };
  }
  async promote(
    taskId: string,
    input: Parameters<CommerceGateway["promote"]>[1],
  ) {
    return this.json(
      `/api/creative-tasks/${taskId}/promote`,
      commercePromoteResultSchema,
      { method: "POST", body: JSON.stringify(input) },
    );
  }
  async upload(
    sessionId: string,
    reference: Parameters<CommerceGateway["upload"]>[1],
  ) {
    if (reference.id) return reference.id;
    if (!reference.file)
      throw new WorkspaceError({
        code: "BAD_REQUEST",
        message: "请重新选择商品图片。",
        retryable: false,
      });
    const form = new FormData();
    form.set("sessionId", sessionId);
    form.set("file", reference.file);
    return (
      await this.json("/api/uploads", referenceUploadResponseSchema, {
        method: "POST",
        body: form,
      })
    ).id;
  }
  private async asset(
    generationId: string,
    allowCache = false,
  ): Promise<{ url?: string; expired: boolean }> {
    if (allowCache) {
      const cached = this.assetCache.get(generationId);
      if (cached && cached.validUntil > Date.now())
        return { url: cached.url, expired: false };
    }
    const pending = this.assetRequests.get(generationId);
    if (pending) return pending;
    const request = this.fetchAsset(generationId);
    this.assetRequests.set(generationId, request);
    try { return await request; }
    finally {
      if (this.assetRequests.get(generationId) === request) this.assetRequests.delete(generationId);
    }
  }
  private async fetchAsset(generationId: string): Promise<{ url?: string; expired: boolean }> {
    try {
      const epoch = this.assetEpoch;
      const result = await this.json(
        `/api/generations/${generationId}/asset-url`,
        generationAssetUrlResponseSchema,
      );
      if (epoch !== this.assetEpoch) throw new Error('Asset owner changed');
      this.assetCache.set(generationId, {
        url: result.url,
        validUntil: Math.min(
          Date.parse(result.expiresAt) - 30_000,
          Date.now() + 60_000,
        ),
      });
      if (this.assetCache.size > 512)
        this.assetCache.delete(this.assetCache.keys().next().value!);
      return { url: result.url, expired: false };
    } catch (error) {
      this.assetCache.delete(generationId);
      if (
        error instanceof WorkspaceError &&
        error.safe.code === "ASSET_EXPIRED"
      )
        return { expired: true };
      throw error;
    }
  }
}
