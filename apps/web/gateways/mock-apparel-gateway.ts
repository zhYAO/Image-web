import {
  apparelCreateSchema,
  apparelSaveSchema,
  apparelSubmitSchema,
  apparelSelectSchema,
  apparelExportSchema,
  apparelTaskSchema,
  apparelOutputNames,
  WorkspaceError,
  type ApparelTask,
  type ApparelGateway,
  type UploadReference,
} from "@zimage/domain";
import type { StorageLike } from "./mock-workspace-gateway";
import { getApparelBlob, putApparelBlob } from "./apparel-blob-store";
import { z } from "zod";
interface State {
  apparel?: {
    tasks: Record<string, ApparelTask>;
    requests: Record<string, { hash: string; taskId: string }>;
    leases: Record<string, { token: string; until: number }>;
  };
  references: Record<string, string>;
  [key: string]: unknown;
}
const conflict = (message: string) =>
  new WorkspaceError({ code: "CONFLICT", message, retryable: true });
export class MockApparelGateway implements ApparelGateway {
  private urls = new Map<string, string>();
  constructor(
    private storage: StorageLike,
    private sessions: () => Promise<Array<{ id: string }>>,
    private serial: <T>(fn: () => Promise<T>) => Promise<T>,
    private uploader: (sid: string, ref: UploadReference) => Promise<string>,
  ) {}
  private state() {
    const state = JSON.parse(
      this.storage.getItem("zimage:commerce:mock:v1") ?? '{"references":{}}',
    ) as State;
    state.apparel ??= { tasks: {}, requests: {}, leases: {} };
    state.apparel.leases ??= {};
    return state;
  }
  private persist(state: State) {
    this.storage.setItem("zimage:commerce:mock:v1", JSON.stringify(state));
  }
  private async owned(state: State, id: string) {
    const task = state.apparel!.tasks[id];
    if (!task || !(await this.sessions()).some((s) => s.id === task.sessionId))
      throw new WorkspaceError({
        code: "NOT_FOUND",
        message: "任务不存在或无权访问。",
        retryable: false,
      });
    return task;
  }
  private async hydrate(task: ApparelTask) {
    const copy = structuredClone(task);
    for (const run of copy.runs)
      for (const asset of run.assets) {
        const blob = await getApparelBlob(asset.id);
        asset.expired = Date.parse(asset.expiresAt) <= Date.now() || !blob;
        if (!asset.expired && blob) {
          if (!this.urls.has(asset.id))
            this.urls.set(asset.id, URL.createObjectURL(blob));
          asset.url = this.urls.get(asset.id);
        }
      }
    return copy;
  }
  async list(sessionId: string) {
    if (!(await this.sessions()).some((s) => s.id === sessionId)) return [];
    return Promise.all(
      Object.values(this.state().apparel!.tasks)
        .filter((t) => t.sessionId === sessionId)
        .map((t) => this.hydrate(t)),
    );
  }
  async get(id: string) {
    return this.hydrate(await this.owned(this.state(), id));
  }
  create(raw: Parameters<ApparelGateway["create"]>[0]) {
    return this.serial(async () => {
      const input = apparelCreateSchema.parse(raw),
        state = this.state();
      if (!(await this.sessions()).some((s) => s.id === input.sessionId))
        throw conflict("会话不存在。");
      const hash = JSON.stringify(input),
        prior = state.apparel!.requests[input.requestId];
      if (prior) {
        if (prior.hash !== hash) throw conflict("请求内容已变化。");
        return this.hydrate(await this.owned(state, prior.taskId));
      }
      const now = new Date().toISOString(),
        task = apparelTaskSchema.parse({
          id: crypto.randomUUID(),
          sessionId: input.sessionId,
          engine: "apparel-catalog",
          revision: 1,
          plan: input.plan,
          createdAt: now,
          updatedAt: now,
          runs: [],
        });
      state.apparel!.tasks[task.id] = task;
      state.apparel!.requests[input.requestId] = { hash, taskId: task.id };
      this.persist(state);
      return this.hydrate(task);
    });
  }
  save(id: string, raw: Parameters<ApparelGateway["save"]>[1]) {
    return this.serial(async () => {
      const input = apparelSaveSchema.parse(raw),
        state = this.state(),
        task = await this.owned(state, id),
        hash = JSON.stringify({ id, input }),
        prior = state.apparel!.requests[input.requestId];
      if (prior) {
        if (prior.hash !== hash) throw conflict("请求内容已变化。");
        return this.hydrate(task);
      }
      if (input.expectedRevision !== task.revision)
        throw conflict("版本已变化。");
      task.revision++;
      task.plan = input.plan;
      task.updatedAt = new Date().toISOString();
      state.apparel!.requests[input.requestId] = { hash, taskId: id };
      this.persist(state);
      return this.hydrate(task);
    });
  }
  async submit(id: string, raw: Parameters<ApparelGateway["submit"]>[1]) {
    const input = apparelSubmitSchema.parse(raw);
    const claim = await this.serial(async () => {
      const state = this.state(),
        task = await this.owned(state, id);
      for (const other of Object.values(state.apparel!.tasks)) {
        const previous = other.runs.find(
          (r) => r.requestId === input.requestId,
        );
        if (
          previous &&
          (other.id !== id || previous.revision !== input.revision)
        )
          throw conflict("请求任务或版本已变化。");
        for (const active of other.runs) {
          if (
            active.status === "processing" &&
            (state.apparel!.leases[active.id]?.until ?? 0) <= Date.now()
          ) {
            active.status = "failed";
            active.error = "执行租约已到期，可继续同一请求。";
            delete state.apparel!.leases[active.id];
          }
        }
      }
      let run = task.runs.find((r) => r.requestId === input.requestId);
      if (run) {
        if (run.revision !== input.revision) throw conflict("请求版本已变化。");
        if (run.status !== "failed")
          return { task: structuredClone(task), run: undefined };
      }
      if (task.revision !== input.revision) throw conflict("版本已变化。");
      if (
        Object.values(state.apparel!.tasks).some((t) =>
          t.runs.some((r) => r.status === "processing"),
        )
      )
        throw conflict("账号已有排版任务，请等待完成。");
      run ??= {
        id: crypto.randomUUID(),
        requestId: input.requestId,
        revision: input.revision,
        status: "processing" as const,
        createdAt: new Date().toISOString(),
        assets: [],
      };
      run.status = "processing";
      run.error = undefined;
      if (!task.runs.includes(run)) task.runs.push(run);
      const token = crypto.randomUUID();
      state.apparel!.leases[run.id] = { token, until: Date.now() + 120000 };
      this.persist(state);
      return { task: structuredClone(task), run: structuredClone(run), token };
    });
    if (!claim.run) return this.hydrate(claim.task);
    const assertLease = (state: State) => {
      const lease = state.apparel!.leases[claim.run!.id];
      if (!lease || lease.token !== claim.token || lease.until <= Date.now())
        throw conflict("执行租约已到期，请继续同一请求。");
    };
    const timer = setInterval(() => {
      void this.serial(async () => {
        const state = this.state();
        assertLease(state);
        state.apparel!.leases[claim.run!.id]!.until = Date.now() + 120000;
        this.persist(state);
      }).catch(() => {});
    }, 25000);
    try {
      const form = new FormData();
      form.set("plan", JSON.stringify(claim.task.plan));
      const ids = [
        ...claim.task.plan.sources.mains,
        ...claim.task.plan.sources.displays.map((d) => d.id),
        claim.task.plan.sources.logo,
      ];
      const state = this.state();
      for (const ref of ids) {
        if (state.references[ref] !== claim.task.sessionId)
          throw conflict("素材属于其他会话或已失效。");
        const blob = await getApparelBlob(ref);
        if (!blob) throw conflict("原始素材已失效，请重新上传。");
        form.set(
          ref,
          blob,
          `${ref}.${ref === claim.task.plan.sources.logo ? "png" : "jpg"}`,
        );
      }
      const response = await fetch("/api/creative-tasks/mock-apparel-render", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body?.message === "string" ? body.message : "排版失败。",
        );
      const pages = z
        .object({
          pages: z.array(
            z.object({
              name: z.string(),
              width: z.number(),
              height: z.number(),
              base64: z.string(),
            }),
          ),
        })
        .parse(body).pages;
      if (
        JSON.stringify(pages.map((p) => p.name)) !==
        JSON.stringify(apparelOutputNames(claim.task.plan))
      )
        throw new Error("排版结果不完整。");
      const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString(),
        assets: ApparelTask["runs"][number]["assets"] = [];
      for (const page of pages) {
        const assetId = crypto.randomUUID(),
          bytes = Uint8Array.from(atob(page.base64), (char) =>
            char.charCodeAt(0),
          );
        await putApparelBlob(
          assetId,
          new Blob([bytes], { type: "image/jpeg" }),
          Date.parse(expiresAt),
        );
        assets.push({
          kind: "layout",
          id: assetId,
          name: page.name,
          width: page.width,
          height: page.height,
          mimeType: "image/jpeg" as const,
          expiresAt,
          expired: false,
        });
      }
      return await this.serial(async () => {
        const state = this.state(),
          task = await this.owned(state, id),
          run = task.runs.find((r) => r.id === claim.run!.id)!;
        assertLease(state);
        run.assets = assets;
        run.status = "succeeded";
        delete state.apparel!.leases[run.id];
        if (task.revision === run.revision) task.selectedRunId = run.id;
        this.persist(state);
        return this.hydrate(task);
      });
    } catch (error) {
      await this.serial(async () => {
        const state = this.state(),
          task = await this.owned(state, id),
          run = task.runs.find((r) => r.id === claim.run!.id)!;
        if (state.apparel!.leases[run.id]?.token !== claim.token) return;
        run.status = "failed";
        run.error = error instanceof Error ? error.message : "排版失败。";
        delete state.apparel!.leases[run.id];
        this.persist(state);
      });
      throw error;
    } finally {
      clearInterval(timer);
    }
  }
  select(id: string, raw: Parameters<ApparelGateway["select"]>[1]) {
    return this.serial(async () => {
      const input = apparelSelectSchema.parse(raw),
        state = this.state(),
        task = await this.owned(state, id);
      if (
        input.revision !== task.revision ||
        !task.runs.some((r) => r.id === input.runId && r.status === "succeeded")
      )
        throw conflict("整套版本不可用。");
      task.selectedRunId = input.runId;
      this.persist(state);
      return this.hydrate(task);
    });
  }
  async export(id: string, raw: Parameters<ApparelGateway["export"]>[1]) {
    const input = apparelExportSchema.parse(raw),
      task = await this.get(id),
      run = task.runs.find((r) => r.id === input.runId);
    if (input.revision !== task.revision) throw conflict("版本已变化。");
    if (!run || run.status !== "succeeded") throw conflict("整套尚未完成。");
    if (run.assets.some((a) => a.expired))
      throw new WorkspaceError({
        code: "ASSET_EXPIRED",
        message: "成品已到期。",
        retryable: false,
      });
    return { runId: run.id, items: run.assets };
  }
  async download(id: string, input: Parameters<ApparelGateway["export"]>[1]) {
    const manifest = await this.export(id, input);
    const form = new FormData();
    for (const item of manifest.items) {
      const blob = await getApparelBlob(item.id);
      if (!blob) throw conflict("成品不可用。");
      form.append("images", blob, item.name);
    }
    const response = await fetch(
      "/api/creative-tasks/mock-apparel-render/download",
      { method: "POST", body: form },
    );
    if (!response.ok) throw conflict("下载失败。");
    return response.blob();
  }
  async upload(sid: string, ref: UploadReference) {
    const id = await this.uploader(sid, ref);
    if (ref.file)
      await putApparelBlob(id, ref.file, Date.now() + 30 * 86400000);
    return id;
  }
}
