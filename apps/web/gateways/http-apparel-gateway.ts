import {
  apparelTaskSchema,
  apparelExportResultSchema,
  apiErrorSchema,
  WorkspaceError,
  type ApparelGateway,
  type UploadReference,
} from "@zimage/domain";
import { z, type ZodType } from "zod";
type Json = <T>(
  path: string,
  schema: ZodType<T>,
  init?: RequestInit,
) => Promise<T>;
export class HttpApparelGateway implements ApparelGateway {
  constructor(
    private json: Json,
    private uploader: (
      sessionId: string,
      reference: UploadReference,
    ) => Promise<string>,
    private fetcher: typeof fetch = fetch,
  ) {}
  private path(id?: string, operation?: string) {
    return `/api/creative-tasks${id ? `/${id}` : ""}${operation ? `/${operation}` : ""}?engine=apparel-catalog`;
  }
  list(sessionId: string) {
    return this.json(
      `${this.path()}&sessionId=${encodeURIComponent(sessionId)}`,
      z.array(apparelTaskSchema),
    );
  }
  get(id: string) {
    return this.json(this.path(id), apparelTaskSchema);
  }
  create(input: Parameters<ApparelGateway["create"]>[0]) {
    return this.json(this.path(), apparelTaskSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  save(id: string, input: Parameters<ApparelGateway["save"]>[1]) {
    return this.json(this.path(id), apparelTaskSchema, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }
  submit(id: string, input: Parameters<ApparelGateway["submit"]>[1]) {
    return this.json(this.path(id, "submit"), apparelTaskSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  select(id: string, input: Parameters<ApparelGateway["select"]>[1]) {
    return this.json(this.path(id, "select"), apparelTaskSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  export(id: string, input: Parameters<ApparelGateway["export"]>[1]) {
    return this.json(this.path(id, "export"), apparelExportResultSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  async download(id: string, input: Parameters<ApparelGateway["export"]>[1]) {
    const networkError = () => new WorkspaceError({
      code: "NETWORK",
      message: "下载失败，请稍后重试。",
      retryable: true,
    });
    let response: Response;
    try {
      response = await this.fetcher(this.path(id, "download"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        credentials: "same-origin",
      });
    } catch {
      throw networkError();
    }
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(
        await response.json().catch(() => null),
      );
      throw new WorkspaceError({
        code:
          response.status === 410
            ? "ASSET_EXPIRED"
            : response.status === 404
              ? "NOT_FOUND"
              : response.status === 409
                ? "CONFLICT"
                : "NETWORK",
        message: parsed.success
          ? parsed.data.message
          : "下载失败，请稍后重试。",
        retryable: response.status >= 500,
      });
    }
    try {
      return await response.blob();
    } catch {
      throw networkError();
    }
  }
  upload(sessionId: string, reference: UploadReference) {
    return this.uploader(sessionId, reference);
  }
}
