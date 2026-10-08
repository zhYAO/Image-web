import { MockApparelGateway } from './mock-apparel-gateway';
import { checkMockQuote } from "./mock-credit-ledger";
import {
  imageCreditItem,
  quoteCredits,
  TRIAL_CREDIT_CATALOG,
} from "@zimage/domain";
import {
  commerceTaskSchema,
  commerceArchiveSchema,
  commerceCancelSchema,
  commercePromoteSchema,
  commerceCreateSchema,
  commerceSaveSchema,
  commerceSubmitSchema,
  commerceSelectSchema,
  commerceExportSchema,
  commerceSlotFingerprint,
  compileCommerceSlot,
  validateCommercePlan,
  MAX_UPLOAD_BYTES,
  WorkspaceError,
  type CommerceGateway,
  type CommerceTask,
  type ImageRequest,
  type GenerationBatch,
} from "@zimage/domain";
import type { StorageLike } from "./mock-workspace-gateway";
const KEY = "zimage:commerce:mock:v1";
interface SlotState {
  version: number;
  selection?: CommerceTask["selections"][number];
  pendingGenerationId?: string;
}
interface State {
  slotStates?: Record<string, Record<string, SlotState>>;
  promotions?: Record<string, string>;
  tasks: Record<string, CommerceTask>;
  requests: Record<string, { hash: string; result: unknown }>;
  references: Record<string, string>;
}
interface Host {
  runCommerceTransaction<T>(work: () => Promise<T>): Promise<T>;
  cancelCommerceImages(batchIds: string[]): Promise<void>;
  listSessions(): Promise<Array<{ id: string }>>;
  submitCommerceImages(requests: ImageRequest[]): Promise<GenerationBatch[]>;
  getGenerationBatch(id: string): Promise<GenerationBatch>;
}
const conflict = (message = "方案已变化，请刷新后再确认。") =>
  new WorkspaceError({ code: "CONFLICT", message, retryable: false });
const copy = <T>(value: T): T => structuredClone(value);
export class MockCommerceGateway implements CommerceGateway {
  readonly apparel: MockApparelGateway;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly storage: StorageLike,
    private readonly host: Host,
  ) { this.apparel = new MockApparelGateway(storage, () => host.listSessions(), work => this.serial(work), (sid, ref) => this.upload(sid, ref)); }
  private load(): State {
    const raw = this.storage.getItem(KEY);
    if (!raw) return { tasks: {}, requests: {}, references: {} };
    return JSON.parse(raw) as State;
  }
  private persist(state: State) {
    this.storage.setItem(KEY, JSON.stringify(state));
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = () => this.host.runCommerceTransaction(fn);
    const result = this.pending.then(run, run);
    this.pending = result.catch(() => undefined);
    return result;
  }
  private async owned(state: State, id: string) {
    const task = state.tasks[id];
    if (
      !task ||
      !(await this.host.listSessions()).some((s) => s.id === task.sessionId)
    )
      throw new WorkspaceError({
        code: "NOT_FOUND",
        message: "创作任务不存在。",
        retryable: false,
      });
    return task;
  }
  private slots(state: State, task: CommerceTask): Record<string, SlotState> {
    state.slotStates ??= {};
    let slots = state.slotStates[task.id];
    if (!slots) {
      // Upgrade legacy snapshots conservatively. Never revive a completed candidate.
      slots = state.slotStates[task.id] = {};
      for (const selection of task.selections)
        slots[selection.slotId] = { version: selection.version, selection };
      for (const slot of task.slots) {
        const saved = (slots[slot.id] ??= { version: 0 });
        const latest = task.runs
          .flatMap((run) => run.items)
          .filter((item) => item.slotId === slot.id)
          .at(-1);
        if (
          latest &&
          ["pending", "processing"].includes(latest.status) &&
          latest.compatibilityHash === task.slotHashes[slot.id] &&
          latest.selectionVersion === saved.version
        )
          saved.pendingGenerationId = latest.generationId;
      }
    }
    for (const slot of task.slots) slots[slot.id] ??= { version: 0 };
    return slots;
  }
  private projectSelections(state: State, task: CommerceTask) {
    const slots = this.slots(state, task);
    task.selections = task.slots.flatMap((slot) =>
      slots[slot.id]?.selection ? [slots[slot.id]!.selection!] : [],
    );
    return task;
  }
  private async refresh(state: State, task: CommerceTask) {
    const slots = this.slots(state, task);
    for (const run of task.runs)
      for (const item of run.items) {
        const batch = await this.host.getGenerationBatch(item.batchId);
        const asset = batch.assets.find((a) => a.id === item.generationId);
        if (asset) {
          item.status = asset.status;
          item.url = asset.url;
          item.expired = asset.expired;
          item.error =
            asset.error?.message === "已取消尚未派发的图片"
              ? "user_cancelled"
              : asset.error?.message;
        }
      }
    for (const slot of task.slots) {
      const saved = slots[slot.id]!;
      const candidate = task.runs
        .flatMap((run) => run.items)
        .find(
          (item) =>
            item.generationId === saved.pendingGenerationId &&
            item.slotId === slot.id,
        );
      if (
        candidate?.status === "succeeded" &&
        !candidate.expired &&
        candidate.compatibilityHash === task.slotHashes[slot.id] &&
        candidate.selectionVersion === saved.version
      ) {
        saved.selection = {
          slotId: slot.id,
          generationId: candidate.generationId,
          compatibilityHash: candidate.compatibilityHash,
          version: saved.version,
        };
        delete saved.pendingGenerationId;
      }
    }
    return this.projectSelections(state, task);
  }
  private async mutate<T>(
    operation: string,
    taskId: string | undefined,
    input: { requestId: string; sessionId?: string },
    work: (state: State, task?: CommerceTask) => Promise<T>,
  ): Promise<T> {
    return this.serial(async () => {
      const state = this.load();
      const task = taskId ? await this.owned(state, taskId) : undefined;
      if (
        operation === "create" &&
        !(await this.host.listSessions()).some(
          (session) => session.id === input.sessionId,
        )
      )
        throw conflict("会话不存在。");
      const key = `${operation}:${input.requestId}`,
        hash = JSON.stringify({ taskId, input });
      const prior = state.requests[key];
      if (prior) {
        if (prior.hash !== hash)
          throw conflict("相同请求编号不能用于不同内容。");
        return copy(prior.result) as T;
      }
      const result = await work(state, task);
      state.requests[key] = { hash, result: copy(result) };
      this.persist(state);
      return copy(result);
    });
  }
  async list(sessionId: string) {
    return this.serial(async () => {
      if (!(await this.host.listSessions()).some((s) => s.id === sessionId))
        return [];
      const state = this.load();
      const tasks = await Promise.all(
        Object.values(state.tasks)
          .filter((t) => t.sessionId === sessionId)
          .map((t) => this.refresh(state, t)),
      );
      this.persist(state);
      return copy(tasks);
    });
  }
  async get(taskId: string) {
    return this.serial(async () => {
      const state = this.load();
      const task = await this.refresh(state, await this.owned(state, taskId));
      this.persist(state);
      return copy(task);
    });
  }
  async create(raw: Parameters<CommerceGateway["create"]>[0]) {
    const input = commerceCreateSchema.parse(raw);
    return this.mutate("create", undefined, input, async (state) => {
      if (
        !(await this.host.listSessions()).some((s) => s.id === input.sessionId)
      )
        throw conflict("会话不存在。");
      input.plan.slots.forEach((slot) =>
        compileCommerceSlot(input.plan.brief, slot, input.plan.templateId),
      );
      const time = new Date().toISOString();
      const task = commerceTaskSchema.parse({
        ...input.plan,
        id: crypto.randomUUID(),
        sessionId: input.sessionId,
        revision: 1,
        createdAt: time,
        updatedAt: time,
        runs: [],
        selections: [],
        slotHashes: Object.fromEntries(
          input.plan.slots.map((s) => [
            s.id,
            commerceSlotFingerprint(input.plan, s),
          ]),
        ),
      });
      state.tasks[task.id] = task;
      this.slots(state, task);
      return task;
    });
  }
  async save(taskId: string, raw: Parameters<CommerceGateway["save"]>[1]) {
    const input = commerceSaveSchema.parse(raw);
    return this.mutate("save", taskId, input, async (state, task) => {
      if (task!.revision !== input.expectedRevision || task!.archived)
        throw conflict();
      input.plan.slots.forEach((slot) =>
        compileCommerceSlot(input.plan.brief, slot, input.plan.templateId),
      );
      await this.refresh(state, task!);
      const slots = this.slots(state, task!);
      const nextHashes = Object.fromEntries(
        input.plan.slots.map((slot) => [
          slot.id,
          commerceSlotFingerprint(input.plan, slot),
        ]),
      );
      for (const [slotId, saved] of Object.entries(slots)) {
        if (saved.pendingGenerationId) {
          const candidate = task!.runs
            .flatMap((run) => run.items)
            .find((item) => item.generationId === saved.pendingGenerationId);
          if (!candidate || candidate.compatibilityHash !== nextHashes[slotId])
            delete saved.pendingGenerationId;
        }
      }
      Object.assign(task!, input.plan, {
        revision: task!.revision + 1,
        updatedAt: new Date().toISOString(),
        slotHashes: nextHashes,
      });
      return this.projectSelections(state, task!);
    });
  }
  async submit(taskId: string, raw: Parameters<CommerceGateway["submit"]>[1]) {
    const input = commerceSubmitSchema.parse(raw);
    return this.mutate("submit", taskId, input, async (state, task) => {
      await this.refresh(state, task!);
      if (task!.revision !== input.revision || task!.archived) throw conflict();
      validateCommercePlan(
        task!.brief,
        task!.scene,
        task!.slots,
        task!.templateId,
      );
      for (const id of [
        ...task!.brief.productReferenceIds,
        ...task!.brief.styleReferenceIds,
      ])
        if (state.references[id] !== task!.sessionId)
          throw conflict("参考图不存在或属于其他会话。");
      if (new Set(input.slotIds).size !== input.slotIds.length)
        throw conflict("图片选择不能重复。");
      const slots = input.slotIds.map((id) => {
        const slot = task!.slots.find((s) => s.id === id);
        if (!slot) throw conflict();
        return slot;
      });
      for (const slot of slots) {
        const items = task!.runs
          .flatMap((r) => r.items)
          .filter((i) => i.slotId === slot.id);
        if (
          items.some((i) => i.status === "pending" || i.status === "processing")
        )
          throw conflict("这张图仍在生成，请等待结果。");
        if (
          !input.recreate &&
          task!.runs.some((run) =>
            run.items.some(
              (item) =>
                item.slotId === slot.id &&
                item.status === "succeeded" &&
                (run.revision === task!.revision ||
                  item.compatibilityHash === task!.slotHashes[slot.id]),
            ),
          )
        )
          throw conflict("已有成功图片，请使用重做。");
      }
      if (input.billing)
        checkMockQuote(
          slots.map((slot) => imageCreditItem({ ...slot, count: 1 })),
          input.billing,
        );
      const runId = crypto.randomUUID();
      const batches = await this.host.submitCommerceImages(
        slots.map((slot) => ({
          ...slot,
          billing: input.billing
            ? {version:input.billing.version,totalMinor:quoteCredits(TRIAL_CREDIT_CATALOG, [
                imageCreditItem({ ...slot, count: 1 }),
              ]).totalMinor}
            : undefined,
          count: 1,
          prompt: compileCommerceSlot(task!.brief, slot, task!.templateId),
          sessionId: task!.sessionId,
          requestId: crypto.randomUUID(),
        })),
      );
      task!.runs.push({
        id: runId,
        revision: input.revision,
        requestId: input.requestId,
        createdAt: new Date().toISOString(),
        items: batches.map((batch, index) => ({
          slotId: slots[index]!.id,
          batchId: batch.id,
          generationId: batch.assets[0]!.id,
          status: batch.assets[0]!.status,
          compatibilityHash: task!.slotHashes[slots[index]!.id]!,
          selectionVersion: this.slots(state, task!)[slots[index]!.id]!.version,
        })),
      });
      for (const item of task!.runs.at(-1)!.items)
        this.slots(state, task!)[item.slotId]!.pendingGenerationId =
          item.generationId;
      return task!;
    });
  }
  async select(taskId: string, raw: Parameters<CommerceGateway["select"]>[1]) {
    const input = commerceSelectSchema.parse(raw);
    return this.mutate("select", taskId, input, async (state, task) => {
      await this.refresh(state, task!);
      if (!task!.slots.some((slot) => slot.id === input.slotId))
        throw conflict("方案中不存在该图片位置。");
      const saved = this.slots(state, task!)[input.slotId]!;
      if (
        task!.revision !== input.revision ||
        saved.version !== input.expectedSelectionVersion
      )
        throw conflict();
      const item = task!.runs
        .flatMap((r) => r.items)
        .find(
          (i) =>
            i.generationId === input.generationId && i.slotId === input.slotId,
        );
      if (!item || item.status !== "succeeded" || item.expired)
        throw conflict("该图片暂不可用。");
      saved.version += 1;
      delete saved.pendingGenerationId;
      saved.selection = {
        slotId: input.slotId,
        generationId: input.generationId,
        compatibilityHash: item.compatibilityHash,
        version: saved.version,
      };
      return this.projectSelections(state, task!);
    });
  }
  async export(taskId: string, raw: Parameters<CommerceGateway["export"]>[1]) {
    const input = commerceExportSchema.parse(raw);
    return this.mutate("export", taskId, input, async (state, task) => {
      await this.refresh(state, task!);
      if (task!.revision !== input.revision) throw conflict();
      if (
        new Set(input.selections.map((s) => s.slotId)).size !==
        input.selections.length
      )
        throw conflict();
      const items = input.selections.map((selection) => {
        const item = task!.runs
          .flatMap((r) => r.items)
          .find(
            (i) =>
              i.slotId === selection.slotId &&
              i.generationId === selection.generationId,
          );
        if (
          !item ||
          item.status !== "succeeded" ||
          item.expired ||
          !task!.slots.some((s) => s.id === selection.slotId)
        )
          throw conflict("所选图片未完成或已过期。");
        return { ...selection, url: item.url };
      });
      return {
        id: crypto.randomUUID(),
        revision: input.revision,
        createdAt: new Date().toISOString(),
        items,
      };
    });
  }
  async archive(
    taskId: string,
    raw: Parameters<CommerceGateway["archive"]>[1],
  ) {
    const input = commerceArchiveSchema.parse(raw);
    return this.mutate("archive", taskId, input, async (state, task) => {
      if (task!.revision !== input.revision) throw conflict();
      task!.archived = true;
      return task!;
    });
  }
  async cancel(taskId: string, raw: Parameters<CommerceGateway["cancel"]>[1]) {
    const input = commerceCancelSchema.parse(raw);
    return this.mutate("cancel", taskId, input, async (state, task) => {
      await this.refresh(state, task!);
      if (task!.revision !== input.revision) throw conflict();
      const run = task!.runs.find((run) => run.id === input.runId);
      if (!run) throw conflict("执行记录不存在。");
      const pending = run.items.filter((item) => item.status === "pending");
      if (!pending.length) throw conflict("没有尚未派发的图片。");
      await this.host.cancelCommerceImages(pending.map((item) => item.batchId));
      for (const item of pending) {
        const saved = this.slots(state, task!)[item.slotId];
        if (saved?.pendingGenerationId === item.generationId)
          delete saved.pendingGenerationId;
      }
      return this.refresh(state, task!);
    });
  }
  async promote(
    taskId: string,
    raw: Parameters<CommerceGateway["promote"]>[1],
  ) {
    const input = commercePromoteSchema.parse(raw);
    return this.mutate("promote", taskId, input, async (state, task) => {
      await this.refresh(state, task!);
      const item = task!.runs
        .flatMap((run) => run.items)
        .find((item) => item.generationId === input.generationId);
      if (!item || item.status !== "succeeded" || item.expired)
        throw conflict("来源图片未完成或已过期。");
      state.promotions ??= {};
      let id = state.promotions[input.generationId];
      if (!id) {
        if (
          Object.values(state.references).filter(
            (sessionId) => sessionId === task!.sessionId,
          ).length >= 64
        )
          throw conflict("此会话的历史素材已达上限，请新建会话。");
        id = crypto.randomUUID();
        state.references[id] = task!.sessionId;
        state.promotions[input.generationId] = id;
      }
      return {
        id,
        name: "生成样图.png",
        mimeType: "image/png" as const,
        size: 1024,
      };
    });
  }
  async upload(
    sessionId: string,
    reference: Parameters<CommerceGateway["upload"]>[1],
  ) {
    return this.serial(async () => {
      const state = this.load();
      if (!(await this.host.listSessions()).some((s) => s.id === sessionId))
        throw conflict("会话不存在。");
      if (reference.id) {
        if (state.references[reference.id] !== sessionId)
          throw conflict("素材属于其他会话或已失效。");
        return reference.id;
      }
      if (
        !reference.file ||
        reference.size > MAX_UPLOAD_BYTES ||
        !["image/png", "image/jpeg", "image/webp"].includes(reference.mimeType)
      )
        throw conflict("请上传 10MB 以内的 PNG/JPEG/WebP 图片。");
      if (
        Object.values(state.references).filter((id) => id === sessionId)
          .length >= 64
      )
        throw conflict("此会话的历史素材已达上限，请新建会话。");
      const id = crypto.randomUUID();
      state.references[id] = sessionId;
      this.persist(state);
      return id;
    });
  }
}
