"use client";

import { publicAssetUrl } from "@/lib/public-assets";
import {
  APPAREL_LAYOUT_VERSION,
  apparelBriefSchema,
  apparelPlanSchema,
  type ApparelBrief,
  type ApparelTask,
  type ApparelGateway,
  type UploadReference,
} from "@zimage/domain";
import { useEffect, useState } from "react";
import { Image } from "antd";
import { Download, Upload, X } from "lucide-react";
import { isLocalCommerceDraft } from "@/features/workspace/workspace-route";
import {
  loadApparelDraft,
  saveApparelDraft,
  type ApparelDraft,
} from "./apparel-draft-storage";
import styles from "./apparel.module.css";
import { ApparelResultImage } from "./ApparelResultImage";
const examplePages = [
  ...Array.from({ length: 5 }, (_, index) => ({
    file: `main-${index + 1}`,
    title: `主图 ${index + 1}`,
    width: 750,
    height: 1000,
  })),
  { file: "detail-01", title: "商品首图", width: 790, height: 1227 },
  { file: "detail-03", title: "商品信息", width: 790, height: 574 },
  { file: "detail-04", title: "尺码信息", width: 790, height: 631 },
  { file: "detail-05", title: "DESIGN", width: 790, height: 1555 },
  { file: "detail-06", title: "FABRIC", width: 790, height: 1243 },
  { file: "detail-07", title: "产品展示", width: 790, height: 1334 },
];
const empty: ApparelBrief = {
  name: "",
  sku: "",
  color: "",
  composition: "",
  care: "",
  size: "",
  measurements: { length: "", chest: "", shoulder: "", sleeve: "" },
  weightRecommendation: "",
  design: "",
  fabric: "",
};
const keyOf = (ref: UploadReference) =>
  ref.file
    ? `${ref.name}:${ref.size}:${ref.file.lastModified}`
    : (ref.id ?? ref.name);
interface Props {
  gateway?: ApparelGateway;
  sessionId: string;
  ownerKey: string;
  task?: ApparelTask;
  references: UploadReference[];
  ensureSession?: (title: string, requestId: string) => Promise<string>;
  onReferenceAdd: (files: FileList) => void;
  onReferenceRemove: (index: number) => void;
  onReferenceUploaded: (
    ref: UploadReference,
    id: string,
    sessionId: string,
  ) => void;
  onTask: (task: ApparelTask, sourceId: string) => void;
}
export function ApparelWorkspace({
  gateway,
  sessionId,
  ownerKey,
  task,
  references,
  ensureSession,
  onReferenceAdd,
  onReferenceRemove,
  onReferenceUploaded,
  onTask,
}: Props) {
  const storageKey = `${ownerKey}:${sessionId}:${task?.id ?? "new"}`;
  const [draft, setDraft] = useState<ApparelDraft>(
    () =>
      loadApparelDraft(storageKey) ?? {
        brief: task?.plan.brief ?? empty,
        crop: task?.plan.fabricCrop ?? [0.24, 0.2, 0.76, 0.57],
        roles: {},
        removed: [],
        sessionRequest: crypto.randomUUID(),
        baseRevision: task?.revision,
      },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [previewRun, setPreviewRun] = useState<string>();
  useEffect(() => {
    try {
      saveApparelDraft(storageKey, draft);
    } catch {}
  }, [storageKey, draft]);
  const update = (patch: Partial<ApparelDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const roleOf = (ref: UploadReference) => {
    const explicit = draft.roles[keyOf(ref)];
    if (explicit) return explicit;
    if (!ref.id || draft.removed.includes(ref.id)) return "unused";
    const main = task?.plan.sources.mains.indexOf(ref.id) ?? -1;
    return main >= 0
      ? `main-${main}`
      : ref.id === task?.plan.sources.logo
        ? "logo"
        : task?.plan.sources.displays.some((item) => item.id === ref.id)
          ? "display"
          : "unused";
  };
  const materials = [...references];
  if (task) {
    const saved = [
      ...task.plan.sources.mains.map((id, i) => ({
        id,
        name: `主图 ${i + 1}.jpg`,
        mimeType: "image/jpeg",
        size: 0,
        status: "ready" as const,
      })),
      ...task.plan.sources.displays.map((item) => ({
        ...item,
        mimeType: "image/jpeg",
        size: 0,
        status: "ready" as const,
      })),
      {
        id: task.plan.sources.logo,
        name: "Logo.png",
        mimeType: "image/png",
        size: 0,
        status: "ready" as const,
      },
    ];
    for (const ref of saved)
      if (
        !references.some((item) => item.id === ref.id) &&
        !draft.removed.includes(ref.id)
      )
        materials.push(ref);
  }
  const group = (role: string) =>
    materials.filter((ref) => roleOf(ref) === role);
  const add = (files: FileList | null, role: string) => {
    if (!files) return;
    const list = Array.from(files),
      expected = role === "logo" ? "image/png" : "image/jpeg";
    if (
      list.some(
        (file) => file.type !== expected || file.size > 10 * 1024 * 1024,
      )
    ) {
      setError(
        `${role === "logo" ? "Logo 须为透明 PNG" : "照片须为 JPEG"}，每张不超过 10 MB。`,
      );
      return;
    }
    if (group(role).length + list.length > (role === "display" ? 20 : 1)) {
      setError(
        role === "display"
          ? "展示照片最多 20 张。"
          : "请先移除当前图片再替换。",
      );
      return;
    }
    const keys = list.map((file) =>
      keyOf({
        file,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        status: "ready",
      }),
    );
    if (
      new Set(keys).size !== keys.length ||
      keys.some((key) =>
        materials.some((ref) => keyOf(ref) === key && roleOf(ref) !== "unused"),
      )
    ) {
      setError("请为每个上传位置选择不同素材。");
      return;
    }
    update({
      roles: {
        ...draft.roles,
        ...Object.fromEntries(keys.map((key) => [key, role])),
      },
    });
    setError(undefined);
    onReferenceAdd(files);
  };
  const remove = (ref: UploadReference) => {
    const index = references.indexOf(ref);
    if (index >= 0) onReferenceRemove(index);
    update({
      roles: { ...draft.roles, [keyOf(ref)]: "unused" },
      removed: ref.id ? [...draft.removed, ref.id] : draft.removed,
    });
  };
  const patch = (
    field: keyof Omit<ApparelBrief, "measurements">,
    value: string,
  ) => update({ brief: { ...draft.brief, [field]: value } });
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    act(async () => {
      if (!gateway) throw new Error("服装排版服务尚未就绪。");
      let current = { ...draft };
      if (!current.pending) {
        apparelBriefSchema.parse(current.brief);
        if (
          Array.from({ length: 5 }, (_, i) => group(`main-${i}`).length).some(
            (count) => count !== 1,
          ) ||
          group("display").length < 1 ||
          group("logo").length !== 1
        )
          throw new Error(
            "请上传五张主图、1–20 张展示照片和一张透明 PNG Logo。",
          );
      }
      const remote =
        current.remoteSession ??
        (isLocalCommerceDraft(sessionId)
          ? await ensureSession?.(current.brief.name, current.sessionRequest)
          : sessionId);
      if (!remote) throw new Error("无法保存会话，请重试。");
      current = { ...current, remoteSession: remote };
      saveApparelDraft(storageKey, current);
      setDraft(current);
      if (!current.pending) {
        const ids = new Map<UploadReference, string>();
        for (const ref of materials.filter((ref) => roleOf(ref) !== "unused")) {
          const id = await gateway.upload(remote, ref);
          ids.set(ref, id);
          onReferenceUploaded(ref, id, sessionId);
        }
        const plan = apparelPlanSchema.parse({
          engine: "apparel-catalog",
          scene: "apparel-catalog",
          layoutVersion: APPAREL_LAYOUT_VERSION,
          brief: current.brief,
          fabricCrop: current.crop,
          sources: {
            mains: Array.from({ length: 5 }, (_, i) =>
              ids.get(group(`main-${i}`)[0]!),
            ),
            displays: group("display").map((ref) => ({
              id: ids.get(ref),
              name: ref.name,
            })),
            logo: ids.get(group("logo")[0]!),
          },
        });
        current = {
          ...current,
          pending: {
            operation: task ? "save" : "create",
            requestId: crypto.randomUUID(),
            plan,
            expectedRevision: current.baseRevision ?? task?.revision,
          },
        };
        saveApparelDraft(storageKey, current);
        setDraft(current);
      }
      const pending = current.pending!;
      const saved =
        pending.operation === "save" && task
          ? await gateway.save(task.id, {
              requestId: pending.requestId,
              expectedRevision: pending.expectedRevision!,
              plan: pending.plan,
            })
          : await gateway.create({
              requestId: pending.requestId,
              sessionId: remote,
              plan: pending.plan,
            });
      current = {
        ...current,
        pending: undefined,
        submit: undefined,
        removed: [],
        baseRevision: saved.revision,
      };
      saveApparelDraft(storageKey, current);
      setDraft(current);
      onTask(saved, sessionId);
    });
  const submit = () =>
    act(async () => {
      if (!gateway || !task) return;
      const last = task.runs
        .filter(
          (run) => run.revision === task.revision && run.status !== "succeeded",
        )
        .at(-1);
      const input =
        draft.submit?.revision === task.revision
          ? draft.submit
          : {
              requestId: last?.requestId ?? crypto.randomUUID(),
              revision: task.revision,
            };
      const current = { ...draft, submit: input };
      saveApparelDraft(storageKey, current);
      setDraft(current);
      const result = await gateway.submit(task.id, input);
      onTask(result, sessionId);
      if (
        result.runs.some(
          (run) =>
            run.requestId === input.requestId && run.status === "succeeded",
        )
      ) {
        const done = { ...current, submit: undefined };
        saveApparelDraft(storageKey, done);
        setDraft(done);
      }
    });
  const run =
    task?.runs.find((item) => item.id === (previewRun ?? task.selectedRunId)) ??
    task?.runs.at(-1);
  const download = () =>
    act(async () => {
      if (!gateway || !task || !run) return;
      const blob = await gateway.download(task.id, {
        requestId: crypto.randomUUID(),
        revision: task.revision,
        runId: run.id,
      });
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `${task.plan.brief.name}-v${run.revision}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  const upload = (title: string, role: string) => (
    <div className={styles.upload} key={role}>
      <strong>{title}</strong>
      {group(role).map((ref) => (
        <div className={styles.material} key={keyOf(ref)}>
          {ref.previewUrl && (
            <Image
              src={ref.previewUrl}
              alt={ref.name}
              width={58}
              height={70}
              style={{ objectFit: "cover" }}
            />
          )}
          <span>{ref.name}</span>
          <button
            type="button"
            disabled={busy}
            aria-label={`移除 ${ref.name}`}
            onClick={() => remove(ref)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <label className={styles.file}>
        <Upload size={14} />
        {group(role).length ? "添加照片" : "上传图片"}
        <input
          aria-label={title}
          type="file"
          accept={role === "logo" ? "image/png" : "image/jpeg"}
          multiple={role === "display"}
          disabled={
            busy ||
            Boolean(draft.pending) ||
            (role !== "display" && group(role).length > 0)
          }
          onChange={(event) => {
            add(event.target.files, role);
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
  const fields: Array<
    [keyof Omit<ApparelBrief, "measurements">, string, boolean?]
  > = [
    ["sku", "款号"],
    ["name", "商品名称"],
    ["color", "颜色"],
    ["composition", "面料成分", true],
    ["care", "洗涤方式", true],
    ["size", "上架尺码"],
    ["weightRecommendation", "体重推荐"],
    ["design", "Design", true],
    ["fabric", "Fabric", true],
  ];
  const dirty = Boolean(
    task &&
    (JSON.stringify(draft.brief) !== JSON.stringify(task.plan.brief) ||
      JSON.stringify(draft.crop) !== JSON.stringify(task.plan.fabricCrop) ||
      draft.removed.length ||
      references.some((ref) => !ref.id && roleOf(ref) !== "unused")),
  );
  const stale = Boolean(
    task &&
    draft.baseRevision !== undefined &&
    draft.baseRevision !== task.revision,
  );
  const loadLatest = () => {
    if (!task) return;
    update({
      brief: task.plan.brief,
      crop: task.plan.fabricCrop,
      roles: {},
      removed: [],
      pending: undefined,
      submit: undefined,
      baseRevision: task.revision,
    });
    setError(undefined);
  };
  return (
    <section className={styles.workspace}>
      <div className={styles.form}>
        <header>
          <h1>服装商品图片</h1>
          <p>固定版式 · 5 张主图 + 790px 详情页 · 不消耗模型积分</p>
        </header>
        {stale && (
          <p role="status">
            已有方案 v{task!.revision}。当前草稿基于 v{draft.baseRevision}
            ；加载最新方案将替换当前表单与素材选择。
            <button type="button" disabled={busy} onClick={loadLatest}>
              加载最新方案
            </button>
          </p>
        )}
        <fieldset disabled={busy || Boolean(draft.pending)}>
          <legend>商品照片</legend>
          <p>主图须为 3:4 JPEG；展示照片按文件名自然排序。每张不超过 10 MB。</p>
          <div className={styles.mains}>
            {Array.from({ length: 5 }, (_, i) =>
              upload(`主图 ${i + 1}`, `main-${i}`),
            )}
          </div>
          {upload("展示照片（1–20 张）", "display")}
          {upload("透明 PNG Logo", "logo")}
        </fieldset>
        <fieldset disabled={busy || Boolean(draft.pending)}>
          <legend>商品资料</legend>
          <div className={styles.fields}>
            {fields.map(([field, title, long]) => (
              <label key={field} className={long ? styles.wide : undefined}>
                {title}
                {long ? (
                  <textarea
                    aria-label={title}
                    rows={3}
                    maxLength={2000}
                    value={draft.brief[field]}
                    onChange={(event) => patch(field, event.target.value)}
                  />
                ) : (
                  <input
                    aria-label={title}
                    value={draft.brief[field]}
                    maxLength={200}
                    onChange={(event) => patch(field, event.target.value)}
                  />
                )}
              </label>
            ))}
            {(["length", "chest", "shoulder", "sleeve"] as const).map(
              (field, i) => (
                <label key={field}>
                  {["衣长", "胸围", "肩宽", "袖长"][i]}
                  <input
                    aria-label={["衣长", "胸围", "肩宽", "袖长"][i]}
                    value={draft.brief.measurements[field]}
                    maxLength={80}
                    onChange={(event) =>
                      update({
                        brief: {
                          ...draft.brief,
                          measurements: {
                            ...draft.brief.measurements,
                            [field]: event.target.value,
                          },
                        },
                      })
                    }
                  />
                </label>
              ),
            )}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {dirty && <p>资料或素材有修改，请先保存新版本。</p>}
        <div className={styles.actions}>
          <button
            type="button"
            disabled={busy || !gateway || (stale && !draft.pending)}
            onClick={save}
          >
            {busy
              ? "正在处理…"
              : draft.pending
                ? "继续保存同一请求"
                : task
                  ? "保存为新版本"
                  : "保存整套方案"}
          </button>
          {task && (
            <button
              className={styles.primary}
              disabled={
                busy || dirty || stale || Boolean(draft.pending) || !gateway
              }
              onClick={submit}
            >
              {task.runs.some(
                (run) =>
                  run.revision === task.revision && run.status !== "succeeded",
              )
                ? "继续同一排版请求"
                : "开始整套排版"}
            </button>
          )}
        </div>
      </div>
      <aside className={styles.preview}>
        <header>
          <h2>整套预览</h2>
          {task && (
            <span>
              方案 v{task.revision} · 版式 {APPAREL_LAYOUT_VERSION}
            </span>
          )}
        </header>
        {task?.runs.length ? (
          <>
            <label>
              历史整套版本
              <select
                aria-label="历史整套版本"
                value={run?.id ?? ""}
                onChange={(event) => setPreviewRun(event.target.value)}
              >
                {[...task.runs].reverse().map((item) => (
                  <option key={item.id} value={item.id}>
                    v{item.revision} ·{" "}
                    {item.status === "succeeded"
                      ? `${item.assets.length} 张成品`
                      : item.status === "failed"
                        ? "失败，可重试"
                        : "执行中"}
                  </option>
                ))}
              </select>
            </label>
            {run?.error && <p role="alert">{run.error}</p>}
            {run?.status === "processing" && (
              <p role="status">正在排版；页面刷新后可继续同一请求。</p>
            )}
            <button
              className={styles.download}
              disabled={
                busy ||
                run?.status !== "succeeded" ||
                run.assets.some((asset) => asset.expired)
              }
              onClick={download}
            >
              <Download size={16} />
              下载原始 JPEG ZIP
            </button>
            <Image.PreviewGroup
              items={run?.assets
                .filter((asset) => !asset.expired && asset.url)
                .map((asset) => asset.url!)}
            >
              <div className={styles.results}>
                {run?.assets.map((asset) => (
                  <figure key={`${ownerKey}:${task.id}:${run.id}:${asset.id}`}>
                    {asset.expired ? (
                      <p>结果已过期</p>
                    ) : (
                      asset.url && (
                        <ApparelResultImage
                          key={asset.url}
                          url={asset.url}
                          name={asset.name}
                        />
                      )
                    )}
                    <figcaption>
                      {asset.name}
                      <br />
                      {asset.width} × {asset.height}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </Image.PreviewGroup>
          </>
        ) : (
          <section className={styles.examples} aria-label="服装排版效果示例">
            <h3>排版效果示例</h3>
            <p>原创 AI 示例 · 虚构商品，仅展示排版。成分、尺码和文案不作为商品事实，也不会填入你的方案。</p>
            <p>5 张 750 × 1000 主图 + 790px 详情模块 · 点击查看原始 JPEG</p>
            <Image.PreviewGroup>
              <div className={styles.results}>
                {examplePages.map((example) => (
                  <figure key={example.file}>
                    <Image
                      src={publicAssetUrl(`/commerce/apparel-v2/${example.file}.webp`)}
                      alt={`原创 AI 服装示例 · ${example.title}`}
                      loading="lazy"
                      preview={{ src: publicAssetUrl(`/commerce/apparel-v2/${example.file}.jpg`) }}
                    />
                    <figcaption>{example.title}<br />{example.width} × {example.height}</figcaption>
                  </figure>
                ))}
              </div>
            </Image.PreviewGroup>
            <p>完整成品保存 90 天，修改后整套排版新版本。</p>
          </section>
        )}
      </aside>
    </section>
  );
}
