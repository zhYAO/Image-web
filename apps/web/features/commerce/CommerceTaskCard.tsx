import { readPending, persistPending, type PendingSubmission } from "./commerce-submission";
import { useCredits, CreditFee } from "@/features/credits/CreditsProvider";
import { imageCreditItem } from "@zimage/domain";
import { notifyCreditsChanged } from "@/gateways/mock-credit-ledger";
import {
  COMMERCE_PLATFORMS,
  COMMERCE_SCENES,
  WorkspaceError,
  validateCommercePlan,
  type CommerceGateway,
  type CommercePlan,
  type CommerceTask,
  type CreditConfirmation,
  type ProviderCapability,
  type UploadReference,
} from "@zimage/domain";
import { Image as AntdImage } from "antd";
import { useEffect, useRef, useState } from "react";
import { CommercePlanFields } from "./CommercePlanFields";
import { CommerceDetailPreview } from "./CommerceDetailPreview";
import {
  downloadCommerceFile,
  planOf,
  templateName,
  unsettledCommerceItem,
  commerceItemNeedsReview,
} from "./commerce-ui";
import styles from "./commerce.module.css";

export interface CommerceEditRequest {
  id: string;
  indexes: number[];
  instruction: string;
}

export interface CommerceConfirmationRequest {
  id: string;
  selection: "all" | "remaining";
}
interface EditDraft {
  plan: CommercePlan;
  indexes: number[];
  revision: number;
}
function mergeEdit(
  current: EditDraft | undefined,
  task: CommerceTask,
  indexes: number[],
  instruction?: string,
): EditDraft {
  const base = current ?? {
    plan: planOf(task),
    indexes: [],
    revision: task.revision,
  };
  return {
    ...base,
    indexes: [...new Set([...base.indexes, ...indexes])].sort((a, b) => a - b),
    plan: {
      ...base.plan,
      slots: base.plan.slots.map((slot, index) =>
        indexes.includes(index) && instruction
          ? {
              ...slot,
              instruction: [slot.instruction, instruction]
                .filter(Boolean)
                .join("\n"),
            }
          : slot,
      ),
    },
  };
}

export function CommerceTaskCard({
  task,
  gateway,
  capabilities,
  onTask,
  onDiscuss,
  onPromote,
  editRequest,
  confirmationRequest,
  onSubmissionPendingChange,
  autoStart = false,
  view = "results",
  onSubmitted,
  originalPreviewUrl,
  previewReferences,
}: {
  view?: "plan" | "results";
  onSubmitted?: () => void;
  originalPreviewUrl?: string;
  previewReferences?: UploadReference[];
  autoStart?: boolean;
  task: CommerceTask;
  gateway: CommerceGateway;
  capabilities: ProviderCapability[];
  onPromote?: (task: CommerceTask, generationId: string) => Promise<void>;
  onTask: (task: CommerceTask) => void;
  onDiscuss?: (taskId: string) => void;
  editRequest?: CommerceEditRequest;
  confirmationRequest?: CommerceConfirmationRequest;
  onSubmissionPendingChange?: (
    taskId: string,
    pending: boolean,
    sessionId: string,
  ) => void;
}) {
  const credits = useCredits();
  const latestFor = (slotId: string) =>
    task.runs
      .flatMap((run) => run.items)
      .filter((item) => item.slotId === slotId)
      .at(-1);
  const [selected, setSelected] = useState<string[]>(() =>
    (task.archived ? [] : task.slots)
      .filter(
        (slot) =>
          !task.selections.some(
            (item) =>
              item.slotId === slot.id &&
              item.compatibilityHash === task.slotHashes[slot.id],
          ) && !unsettledCommerceItem(latestFor(slot.id)),
      )
      .map((slot) => slot.id),
  );
  const [edit, setEdit] = useState<EditDraft | undefined>(() =>
    editRequest
      ? mergeEdit(undefined, task, editRequest.indexes, editRequest.instruction)
      : undefined,
  );
  const [seenEditRequest, setSeenEditRequest] = useState(editRequest?.id);
  if (editRequest && seenEditRequest !== editRequest.id) {
    setSeenEditRequest(editRequest.id);
    setEdit((current) =>
      mergeEdit(current, task, editRequest.indexes, editRequest.instruction),
    );
  }
  const [message, setMessage] = useState<string>();
  const [exportFormat, setExportFormat] = useState<'jpg' | 'png'>('jpg');
  const [exportFocus, setExportFocus] = useState({ x: 0.5, y: 0.5 });
  const [referenceUrls, setReferenceUrls] = useState<Record<string, string>>({});
  const [originalUrl, setOriginalUrl] = useState(originalPreviewUrl);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (task.scene !== 'product-main' || originalPreviewUrl || !task.brief.productReferenceIds[0]) return;
    let active = true;
    void fetch(`/api/references/${task.brief.productReferenceIds[0]}/asset-url`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(result => { if (active && typeof result?.url === 'string') setOriginalUrl(result.url); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [task.scene, task.brief.productReferenceIds, originalPreviewUrl]);
  const cloneReferenceKey = task.brief.styleReferenceIds.join(',');
  useEffect(() => {
    if (task.scene !== 'clone') return;
    let cancelled = false;
    void Promise.all(cloneReferenceKey.split(',').filter(Boolean).map(async id => {
      const local = previewReferences?.find(reference => reference.id === id)?.previewUrl;
      if (local) return [id, local] as const;
      if (process.env.NEXT_PUBLIC_DATA_MODE === 'mock') return undefined;
      try { const response = await fetch(`/api/references/${id}/asset-url`, { cache: 'no-store' }); const result = response.ok ? await response.json() : null; return typeof result?.url === 'string' ? [id, result.url] as const : undefined; } catch { return undefined; }
    })).then(entries => { if (!cancelled) setReferenceUrls(Object.fromEntries(entries.filter((item): item is readonly [string, string] => Boolean(item)))); });
    return () => { cancelled = true; };
  }, [task.scene, cloneReferenceKey, previewReferences]);
  const storageKey = `zimage-commerce-submit:${task.id}`;
  const [pendingRequest, setPendingRequest] = useState(() =>
    readPending(storageKey),
  );
  const unknown = Boolean(
    pendingRequest &&
    !pendingRequest.rejected &&
    !task.runs.some((run) => run.requestId === pendingRequest.requestId),
  );
  const lock = useRef(false);
  const autoStarted = useRef(false);
  const submitRequest = useRef<PendingSubmission | undefined>(pendingRequest);
  const lifecycleKeys = useRef(new Map<string, string>());
  const saveRequest = useRef<{ key: string; requestId: string } | undefined>(
    undefined,
  );
  const openEdit = (indexes: number[], instruction?: string) =>
    setEdit((current) => mergeEdit(current, task, indexes, instruction));
  const [seenConfirmation, setSeenConfirmation] = useState<string>();
  if (confirmationRequest && seenConfirmation !== confirmationRequest.id) {
    setSeenConfirmation(confirmationRequest.id);
    if (edit) setMessage("请先保存或取消当前修改，再确认生成。");
    else {
      setSelected(
        task.archived
          ? []
          : task.slots
              .filter(
                (slot) =>
                  !unsettledCommerceItem(latestFor(slot.id)) &&
                  (confirmationRequest.selection === "all" ||
                    !task.selections.some(
                      (item) =>
                        item.slotId === slot.id &&
                        item.compatibilityHash === task.slotHashes[slot.id],
                    )),
              )
              .map((slot) => slot.id),
      );
      setMessage(
        `已定位方案 v${task.revision}，请核对本次图片与额度，再点击确认生成。`,
      );
    }
  }
  useEffect(() => {
    onSubmissionPendingChange?.(task.id, unknown, task.sessionId);
  }, [task.id, task.sessionId, unknown, onSubmissionPendingChange]);
  const recordSubmissionFailure = (
    cause: unknown,
    request: PendingSubmission,
  ) => {
    const rejected =
      cause instanceof WorkspaceError &&
      !["NETWORK", "UNKNOWN", "PROVIDER_ERROR"].includes(cause.safe.code);
    const pending = { ...request, rejected };
    submitRequest.current = pending;
    setPendingRequest(pending);
    persistPending(storageKey, pending);
  };
  useEffect(() => {
    if (
      pendingRequest &&
      task.runs.some((run) => run.requestId === pendingRequest.requestId)
    )
      persistPending(storageKey);
  }, [pendingRequest, task.runs, storageKey]);
  const perform = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const confirm = (confirmedPrice?:CreditConfirmation) =>
    perform(async () => {
      if (edit) throw new Error("请先保存或取消当前修改，再确认生成。");
      const payload = {
        billing:
          confirmedPrice ??
          credits.confirm(
            task.slots
          .filter((slot) => selected.includes(slot.id))
          .map((slot) => imageCreditItem({ ...slot, count: 1 })),
          ),
        revision: task.revision,
        slotIds: task.slots
          .filter((slot) => selected.includes(slot.id))
          .map((slot) => slot.id),
        recreate: task.runs.length > 0,
        source: "direct" as const,
      };
      const key = JSON.stringify(payload);
      if (unknown && submitRequest.current?.key !== key)
        throw new Error("上次提交结果未知，请先恢复原请求。");
      if (
        !unknown &&
        (submitRequest.current?.key !== key ||
          task.runs.some(
            (run) => run.requestId === submitRequest.current?.requestId,
          ))
      )
        submitRequest.current = { key, requestId: crypto.randomUUID() };
      const request = submitRequest.current!;
      setPendingRequest(request);
      persistPending(storageKey, request);
      try {
        const updated = await gateway.submit(task.id, {
          ...payload,
          requestId: request.requestId,
        });
        notifyCreditsChanged();
        onTask(updated);
        setSelected([]);
        setPendingRequest(undefined);
        submitRequest.current = undefined;
        persistPending(storageKey);
        setMessage("已确认，正在逐图生成。");
        onSubmitted?.();
      } catch (cause) {
        recordSubmissionFailure(cause, request);
        throw cause;
      }
    });
  useEffect(() => {
    // A direct-generate click authorizes exactly this saved task once. A restored
    // pending submission keeps its original recovery path and idempotency key.
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    if (!task.runs.length && !pendingRequest) void confirm(credits.recalled(task.id));
  });
  const recover = () =>
    perform(async () => {
      const current = await gateway.get(task.id);
      onTask(current);
      const request = submitRequest.current;
      if (!request) return;
      if (current.runs.some((run) => run.requestId === request.requestId)) {
        setPendingRequest(undefined);
        setSelected([]);
        persistPending(storageKey);
        return;
      }
      const payload = JSON.parse(request.key) as Parameters<
        CommerceGateway["submit"]
      >[1];
      try {
        const updated = await gateway.submit(task.id, {
          ...payload,
          requestId: request.requestId,
        });
        notifyCreditsChanged();
        onTask(updated);
        setPendingRequest(undefined);
        setSelected([]);
        submitRequest.current = undefined;
        persistPending(storageKey);
      } catch (cause) {
        recordSubmissionFailure(cause, request);
        throw cause;
      }
    });
  const saveEdit = () =>
    perform(async () => {
      if (!edit) return;
      validateCommercePlan(
        edit.plan.brief,
        edit.plan.scene,
        edit.plan.slots,
        edit.plan.templateId,
      );
      const key = JSON.stringify({ revision: edit.revision, plan: edit.plan });
      if (saveRequest.current?.key !== key)
        saveRequest.current = { key, requestId: crypto.randomUUID() };
      const updated = await gateway.save(task.id, {
        expectedRevision: edit.revision,
        plan: edit.plan,
        requestId: saveRequest.current.requestId,
      });
      onTask(updated);
      setSelected(
        edit.indexes.flatMap((index) => updated.slots[index]?.id ?? []),
      );
      setEdit(undefined);
      setMessage(
        `修改方案已保存；仅选中 ${edit.indexes.length} 张，确认后才生成。`,
      );
    });
  const lifecycle = (operation: "archive" | "cancel", runId?: string) =>
    perform(async () => {
      const key = `${operation}:${task.revision}:${runId ?? ""}`;
      let requestId = lifecycleKeys.current.get(key);
      if (!requestId) {
        requestId = crypto.randomUUID();
        lifecycleKeys.current.set(key, requestId);
      }
      const updated =
        operation === "archive"
          ? await gateway.archive(task.id, {
              requestId,
              revision: task.revision,
            })
          : await gateway.cancel(task.id, {
              requestId,
              revision: task.revision,
              runId: runId!,
            });
      onTask(updated);
      if (operation === "archive") {
        setEdit(undefined);
        setSelected([]);
      }
      setMessage(
        operation === "archive"
          ? "任务已归档，不再接受新生成；历史图片与下载保留。"
          : "已核对未派发图片的取消请求；已开始处理的图片继续执行。",
      );
    });
  const latest = task.slots.map((slot) =>
    task.runs
      .flatMap((run) => run.items)
      .filter((item) => item.slotId === slot.id)
      .at(-1),
  );
  const pending = latest.some(unsettledCommerceItem);
  const awaitingReview = latest.some(commerceItemNeedsReview);
  const generating = latest.some(
    (item) => unsettledCommerceItem(item) && !commerceItemNeedsReview(item),
  );
  const failures = latest.filter((item) => item?.status === "failed").length;
  const title = !task.runs.length
    ? "待确认"
    : generating
      ? "生成中"
      : awaitingReview
        ? "结果待核对"
        : failures
          ? task.selections.length
            ? "部分失败"
            : "失败"
          : task.selections.length === task.slots.length
            ? "已完成"
            : "待确认剩余图片";
  const available = task.slots.filter((slot) =>
    task.selections.some((item) => item.slotId === slot.id),
  );
  const canEdit = !busy && !unknown && !task.archived;
  return (
    <article
      className={styles.taskCard}
      data-testid="commerce-task"
      data-task-id={task.id}
      data-view={view}
      id={`commerce-task-${task.id}`}
    >
      <header className={styles.heading}>
        <div>
          <h2>
            {task.brief.name} ·{" "}
            {COMMERCE_SCENES.find((item) => item.id === task.scene)?.name}
          </h2>
          <p>
            {
              COMMERCE_PLATFORMS.find((item) => item.id === task.brief.platform)
                ?.name
            }{" "}
            · {task.brief.placement} · {templateName(task.templateId)} · 方案 v
            {task.revision}
          </p>
        </div>
        <strong role="status">
          {task.archived ? `已归档 · ${title}` : title}
        </strong>
      </header>
      <p className={styles.note}>
        新成功图默认采用，可手动切回旧图。请核对{task.brief.contentMode === "content" ? "内容与排版" : "商品外观与文字"}；改字需要重新生成。
      </p>
      {task.scene === 'detail' && view === 'results' && <CommerceDetailPreview task={task} />}
      <div className={styles.resultGrid}>
        {task.slots.map((slot, index) => {
          const candidates = task.runs
            .flatMap((run) => run.items)
            .filter(
              (item) => item.slotId === slot.id && item.status === "succeeded",
            );
          const selection = task.selections.find(
            (item) => item.slotId === slot.id,
          );
          const stale =
            selection &&
            selection.compatibilityHash !== task.slotHashes[slot.id];
          const image = candidates.find(
            (item) => item.generationId === selection?.generationId,
          );
          const running = latest[index];
          return (
            <section className={styles.result} key={slot.id}>
              <h3>
                第 {index + 1} 张 · {slot.role}
              </h3>
              {task.scene === 'clone' && view !== 'plan' && <figure className={styles.cloneReference}>{referenceUrls[slot.referenceIds.find(id => task.brief.styleReferenceIds.includes(id)) ?? ''] ? <AntdImage src={referenceUrls[slot.referenceIds.find(id => task.brief.styleReferenceIds.includes(id)) ?? '']} alt={`第 ${index + 1} 张复刻参考图`} /> : <span>参考图 {index + 1} · 预览暂不可用</span>}<figcaption>复刻参考 → 对应结果</figcaption></figure>}
              {view === "plan" ? (
                <span className={styles.planNumber}>
                  方案 {String(index + 1).padStart(2, "0")}
                </span>
              ) : image?.url && !image.expired ? (
                <div className={task.scene === 'product-main' && originalUrl ? styles.originalCompare : undefined}>
                  {task.scene === 'product-main' && originalUrl && <figure><AntdImage src={originalUrl} alt={`${task.brief.name} 原图`} /><figcaption>商品原图</figcaption></figure>}
                  <figure><AntdImage src={image.url} alt={`${task.brief.name} 第 ${index + 1} 张当前选图`} /><figcaption>生成候选 {index + 1}</figcaption></figure>
                </div>
              ) : (
                <div className={styles.placeholder}>
                  {image?.expired
                    ? "图片已到期"
                    : commerceItemNeedsReview(running)
                      ? "生成结果待核对"
                      : running?.status === "processing"
                        ? "正在生成…"
                        : running?.status === "pending"
                          ? "已排队"
                          : "等待生成"}
                </div>
              )}
              {stale && (
                <p className={styles.reviewNotice} role="status">
                  当前选图来自旧方案；可保留下载，或确认重做以应用修改。
                </p>
              )}
              {commerceItemNeedsReview(running) && (
                <p className={styles.reviewNotice} role="status">
                  服务商连接中断，尚未收到这张图片。为避免重复扣费，已暂停自动重试。请联系支持核对任务{" "}
                  {running?.generationId.slice(0, 8)}。
                </p>
              )}
              {running?.status === "failed" &&
                !commerceItemNeedsReview(running) &&
                unsettledCommerceItem(running) && (
                  <p className={styles.reviewNotice} role="status">
                    结果待恢复，暂不能重新提交；正在核对生成结果或完成图片存储。
                  </p>
                )}
              {running?.status === "failed" &&
                !unsettledCommerceItem(running) && (
                  <p className={styles.failureNotice} role="status">
                    生成失败：{running.error || "请调整方案后重试"}
                    {image ? "。已保留原选图。" : ""}
                  </p>
                )}
              {pending &&
                image &&
                running &&
                ["pending", "processing"].includes(running.status) && (
                  <p>重做中，保留原选图</p>
                )}
              <p>
                {slot.instruction || (task.brief.contentMode === "content" ? "按原文内容与模板排版" : "按商品事实与模板规划")}
                {slot.textMode === 'auto' && <><br />文案：从商品描述自动提炼</>}
                {slot.textMode === 'none' && <><br />不加文字</>}
                {slot.exactText && (!slot.textMode || slot.textMode === 'exact') && (
                  <>
                    <br />
                    文案：{slot.exactText}
                  </>
                )}
                <br />
                {slot.provider} · {slot.model} · {slot.aspectRatio} ·{" "}
                {slot.resolution}
              </p>
              <label className={styles.checkbox}>
                <input
                  aria-label={`生成第 ${index + 1} 张`}
                  type="checkbox"
                  disabled={!canEdit || unsettledCommerceItem(running)}
                  checked={selected.includes(slot.id)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, slot.id]
                        : selected.filter((id) => id !== slot.id),
                    )
                  }
                />
                参与本次生成
              </label>
              {candidates.length > 0 && (
                <label>
                  当前选图
                  <select
                    aria-label={`第 ${index + 1} 张历史版本`}
                    value={selection?.generationId ?? ""}
                    disabled={busy || unknown}
                    onChange={(event) =>
                      void perform(async () => {
                        onTask(
                          await gateway.select(task.id, {
                            requestId: crypto.randomUUID(),
                            revision: task.revision,
                            slotId: slot.id,
                            generationId: event.target.value,
                            expectedSelectionVersion: selection?.version ?? 0,
                          }),
                        );
                      })
                    }
                  >
                    <option disabled value="">
                      请选择结果
                    </option>
                    {candidates.map((item, candidateIndex) => (
                      <option
                        key={item.generationId}
                        value={item.generationId}
                        disabled={item.expired || !item.url}
                      >
                        第 {candidateIndex + 1} 版
                        {item.expired ? "（已到期）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className={styles.actions}>
                {image && onPromote && (
                  <button
                    disabled={!canEdit || !image.url || image.expired}
                    onClick={() =>
                      void perform(() => onPromote(task, image.generationId))
                    }
                  >
                    采用第 {index + 1} 张为风格参考
                  </button>
                )}
                <button disabled={!canEdit} onClick={() => openEdit([index])}>
                  修改第 {index + 1} 张
                </button>
                {selection && (
                  <button
                    disabled={busy || !image?.url || image.expired}
                    onClick={() =>
                      void perform(async () =>
                        setMessage(
                          await downloadCommerceFile(gateway, task, [slot.id], 'single', exportFormat, exportFocus),
                        ),
                      )
                    }
                  >
                    下载第 {index + 1} 张
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {pendingRequest &&
        !busy &&
        !task.runs.some(
          (run) => run.requestId === pendingRequest.requestId,
        ) && (
          <p role="alert">
            {unknown
              ? "连接中断，正在核对提交状态。已保留本次请求，恢复后不会重复生成。"
              : "请求未入队，已保留原请求；可恢复重试，或编辑后确认新方案。"}
            <button disabled={busy} onClick={() => void recover()}>
              恢复原提交
            </button>
          </p>
        )}
      {message && <p role="status">{message}</p>}
      <div className={styles.actions}>
        <label>导出格式<select aria-label="导出格式" value={exportFormat} onChange={event => setExportFormat(event.target.value as 'jpg' | 'png')}><option value="jpg">JPG</option><option value="png">PNG</option></select></label>
        {task.scene === 'detail' && <label>横向裁切位置<input aria-label="横向裁切位置" type="range" min="0" max="100" value={exportFocus.x * 100} onChange={event => setExportFocus(current => ({ ...current, x: Number(event.target.value) / 100 }))} /></label>}
        {task.runs
          .filter((run) => run.items.some((item) => item.status === "pending"))
          .map((run) => (
            <button
              key={run.id}
              disabled={busy || unknown}
              onClick={() => void lifecycle("cancel", run.id)}
            >
              取消未派发图片
            </button>
          ))}
        {!task.archived && (
          <button
            disabled={busy || unknown}
            onClick={() => void lifecycle("archive")}
          >
            归档任务
          </button>
        )}
        <button
          disabled={!canEdit || pending}
          onClick={() =>
            setSelected(
              task.slots
                .filter(
                  (slot) =>
                    !task.selections.some(
                      (item) =>
                        item.slotId === slot.id &&
                        item.compatibilityHash === task.slotHashes[slot.id],
                    ),
                )
                .map((slot) => slot.id),
            )
          }
        >
          选择剩余图片
        </button>
        <button
          disabled={!canEdit || pending}
          onClick={() => setSelected(task.slots.map((slot) => slot.id))}
        >
          选择全部
        </button>
        <button
          disabled={!canEdit}
          onClick={() => openEdit(task.slots.map((_, index) => index))}
        >
          修改整套方案
        </button>
        {onDiscuss && (
          <button disabled={!canEdit} onClick={() => onDiscuss(task.id)}>
            在对话中修改此任务
          </button>
        )}
        <button
          disabled={busy || !available.length}
          onClick={() =>
            void perform(async () =>
              setMessage(
                await downloadCommerceFile(gateway, task, available.map((slot) => slot.id), 'zip', exportFormat, exportFocus),
              ),
            )
          }
        >
          ZIP 下载当前选图（{available.length} 张）
        </button>
        {task.scene === 'detail' && available.some(slot => slot.outputSpec === 'standard') && <button disabled={busy} onClick={() => void perform(async () => setMessage(await downloadCommerceFile(gateway, task, available.filter(slot => slot.outputSpec === 'standard').map(slot => slot.id), 'long', exportFormat, exportFocus)))}>导出普通 A+ 长图</button>}
        {task.scene === 'detail' && available.some(slot => slot.outputSpec === 'desktop') && <button disabled={busy} onClick={() => void perform(async () => setMessage(await downloadCommerceFile(gateway, task, available.filter(slot => slot.outputSpec === 'desktop').map(slot => slot.id), 'long', exportFormat, exportFocus)))}>导出桌面长图</button>}
        {task.scene === 'detail' && available.some(slot => slot.outputSpec === 'mobile') && <button disabled={busy} onClick={() => void perform(async () => setMessage(await downloadCommerceFile(gateway, task, available.filter(slot => slot.outputSpec === 'mobile').map(slot => slot.id), 'long', exportFormat, exportFocus)))}>导出移动长图</button>}
      </div>
      {edit && <p role="status">请先保存或取消当前修改，再确认生成。</p>}
      <CreditFee
        items={task.slots
          .filter((slot) => selected.includes(slot.id))
          .map((slot) => imageCreditItem({ ...slot, count: 1 }))}
      />
      <div className={styles.confirm}>
        <span>
          本次选中 {selected.length} 张，将消耗 {selected.length} 张图片额度
          {selected.some((id) =>
            task.selections.some((item) => item.slotId === id),
          )
            ? "（含重做）"
            : ""}
          。
        </span>
        <button
          className={styles.primary}
          disabled={
            !canEdit ||
            Boolean(edit) ||
            !selected.length ||
            selected.some((id) =>
              latest.some(
                (item) => item?.slotId === id && unsettledCommerceItem(item),
              ),
            )
          }
          onClick={() => void confirm()}
        >
          {busy ? "正在处理…" : `确认生成 ${selected.length} 张`}
        </button>
      </div>
      {edit && (
        <div
          className={styles.editPanel}
          role="dialog"
          aria-modal="false"
          aria-label="修改分图方案"
        >
          <h3>
            修改方案 · {task.brief.name} · v{edit.revision}
          </h3>
          <p>
            影响：{edit.indexes.map((index) => `第 ${index + 1} 张`).join("、")}
            。保存后还需确认生成；仅重新生成选中的图片。
          </p>
          <CommercePlanFields
            disabled={busy}
            numbers={edit.indexes.map((index) => index + 1)}
            plan={{
              ...edit.plan,
              slots: edit.plan.slots.filter((_, index) =>
                edit.indexes.includes(index),
              ),
            }}
            capabilities={capabilities}
            onChange={(changed) =>
              setEdit({
                ...edit,
                plan: {
                  ...edit.plan,
                  slots: edit.plan.slots.map(
                    (slot) =>
                      changed.slots.find((item) => item.id === slot.id) ?? slot,
                  ),
                },
              })
            }
          />
          <div className={styles.actions}>
            <button
              className={styles.primary}
              disabled={busy}
              onClick={() => void saveEdit()}
            >
              保存修改方案
            </button>
            <button disabled={busy} onClick={() => setEdit(undefined)}>
              取消修改
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
