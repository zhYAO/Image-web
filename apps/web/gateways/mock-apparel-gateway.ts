import {
  apparelCreateSchema,
  apparelSaveSchema,
  apparelSelectSchema,
  apparelExportSchema,
  apparelTaskSchema,
  WorkspaceError,
  type ApparelTask,
  type ApparelGateway,
  type UploadReference,
} from "@zimage/domain";
import type { StorageLike } from "./mock-workspace-gateway";
import { getApparelBlob, putApparelBlob } from "./apparel-blob-store";
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
  async submit(): Promise<ApparelTask> {
    throw new Error("服装固定排版已停用，请前往生图工作台使用提示词生图。");
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
