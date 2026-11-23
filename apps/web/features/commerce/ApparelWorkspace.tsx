"use client";

import Link from "next/link";

import { PreviewImage, ImageGallery } from '@/features/controls/PreviewImage';
import { CommerceSelect } from "@/features/commerce/CommerceSelect";

import { publicAssetUrl } from "@/lib/public-assets";
import {
  APPAREL_LAYOUT_VERSION,
  apparelBriefSchema,
  type ApparelBrief,
  type ApparelTask,
  type ApparelGateway,
  type UploadReference,
} from "@zimage/domain";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { HttpApparelGateway } from "@/gateways/http-apparel-gateway";

import { Download, Upload, X } from "lucide-react";
import {
  loadApparelDraft,
  saveApparelDraft,
  type ApparelDraft,
} from "./apparel-draft-storage";
import styles from "./apparel.module.css";
import { ApparelResultImage } from "./ApparelResultImage";
import { buildApparelModelPrompt } from "./apparel-model-prompt";
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
  onReferenceAdd: (files: FileList) => void;
  onReferenceRemove: (index: number) => void;
  onPrepareModelPrompt?: (prompt: string, references: UploadReference[]) => boolean;
}
export function ApparelWorkspace({
  gateway,
  sessionId,
  ownerKey,
  task,
  references,
  onReferenceAdd,
  onReferenceRemove,
  onPrepareModelPrompt,
}: Props) {
  const storageKey = `${ownerKey}:${sessionId}:${task?.id ?? "new"}`;
  const ownerScope = useRef({ active: false, epoch: 0, storageKey, gateway });
  useLayoutEffect(() => {
    ownerScope.current = { active: true, epoch: ownerScope.current.epoch + 1, storageKey, gateway };
    return () => { ownerScope.current.active = false; ownerScope.current.epoch++; };
  }, [storageKey, gateway]);
  const captureOwner = useCallback(() => {
    const epoch = ownerScope.current.epoch;
    return () => {
      if (!ownerScope.current.active || ownerScope.current.epoch !== epoch || ownerScope.current.storageKey !== storageKey || ownerScope.current.gateway !== gateway) return false;
      try { if (gateway instanceof HttpApparelGateway) gateway.assertOwnerCurrent(); } catch { return false; }
      return true;
    };
  }, [storageKey, gateway]);
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
    if (!captureOwner()()) return;
    try {
      saveApparelDraft(storageKey, draft);
    } catch {}
  }, [captureOwner, storageKey, draft]);
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
    if (materials.filter((ref) => ref.file && roleOf(ref) !== "unused").length + list.length > 4) {
      setError("生图最多支持 4 张参考图。");
      return;
    }
    if (group(role).filter((ref) => ref.file).length + list.length > (role === "display" ? 4 : 1)) {
      setError(
        role === "display"
          ? "展示照片最多 4 张。"
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
  const act = async (work: (isCurrent: () => boolean) => Promise<void>) => {
    const isCurrent = captureOwner();
    if (busy || !isCurrent()) return;
    setBusy(true);
    setError(undefined);
    try {
      await work(isCurrent);
    } catch (error) {
      if (isCurrent()) setError(error instanceof Error ? error.message : "操作失败，请重试。");
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };
  const prepare = () => {
    if (!captureOwner()() || !onPrepareModelPrompt) return;
    setError(undefined);
    try {
      const selected = materials.filter((ref) => ref.file && roleOf(ref) !== "unused");
      const prompt = buildApparelModelPrompt(apparelBriefSchema.parse(draft.brief), selected.map(roleOf));
      if (!onPrepareModelPrompt(prompt, selected)) setError("生图工作台已有未发送的草稿或参考图；请先处理那份草稿。");
    } catch (error) {
      setError(error instanceof Error && error.name !== "ZodError" ? error.message : "请填写必填商品资料，并检查字数限制。");
    }
  };
  const run =
    task?.runs.find((item) => item.id === (previewRun ?? task.selectedRunId)) ??
    task?.runs.at(-1);
  const download = () =>
    act(async (isCurrent) => {
      if (!gateway || !task || !run) return;
      const blob = await gateway.download(task.id, {
        requestId: crypto.randomUUID(),
        revision: task.revision,
        runId: run.id,
      });
      if (!isCurrent()) return;
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
            <PreviewImage
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
            busy || (role !== "display" && group(role).some((ref) => ref.file))
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
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="工具导航"><Link href="/create">工具目录</Link><span>/</span><h1>服装商品图片</h1></nav>
    <section className={styles.workspace}>
      <div className={styles.form}>
        <div className={styles.formScroll}>
        <header>
          <h1>服装商品图片</h1>
          <p>根据商品资料准备中文生图提示词，不使用额外字体。在生图工作台发送后才生图，按模型计费。</p>
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
        <fieldset disabled={busy}>
          <legend>商品照片</legend>
          <p>参考图可选，最多 4 张。历史任务中的照片需重新上传才会传入新提示词。</p>
          <div className={styles.mains}>
            {Array.from({ length: 5 }, (_, i) =>
              upload(`主图 ${i + 1}`, `main-${i}`),
            )}
          </div>
          {upload("展示照片（可选）", "display")}
          {upload("透明 PNG Logo", "logo")}
        </fieldset>
        <fieldset disabled={busy}>
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
        </div>
        <footer className={styles.actionBar}>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={busy || stale || !onPrepareModelPrompt} onClick={prepare}>
            前往生图工作台
          </button>
        </div>
        </footer>
      </div>
      <aside className={`${styles.preview} ${!task?.runs.length ? styles.previewWithExamples : ""}`}>
        <header>
          <div><span className={styles.overline}>APPAREL STUDIO</span><h2>整套效果</h2></div>
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
              <CommerceSelect
                aria-label="历史整套版本"
                value={run?.id ?? ""}
                onChange={(value) => setPreviewRun(value)}
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
              </CommerceSelect>
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
            <ImageGallery sources={run?.assets.filter(asset => !asset.expired && asset.url).map(asset => ({ src: asset.url!, alt: asset.name }))}>
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
            </ImageGallery>
          </>
        ) : (
          <section className={styles.examples} aria-label="服装排版效果示例">
            <ImageGallery>
              <div className={styles.results}>
                {examplePages.map((example) => (
                  <figure key={example.file}>
                    <PreviewImage
                      src={publicAssetUrl(`/commerce/apparel-v2/${example.file}.webp`)}
                      alt={`原创 AI 服装示例 · ${example.title}`}
                      loading="lazy"
                      fullSource={publicAssetUrl(`/commerce/apparel-v2/${example.file}.jpg`)}
                    />
                    <figcaption>{example.title}<small>{example.width} × {example.height}</small></figcaption>
                  </figure>
                ))}
              </div>
            </ImageGallery>
            <details className={styles.exampleNotes}>
              <summary>示例说明与成品保留规则</summary>
            <p>原创 AI 示例 · 虚构商品，仅展示排版。成分、尺码和文案不作为商品事实，也不会填入你的方案。</p>
            <p>5 张 750 × 1000 主图 + 790px 详情模块 · 点击查看原始 JPEG</p>
            <p>完整成品保存 90 天，修改后整套排版新版本。</p>
            </details>
          </section>
        )}
      </aside>
    </section></div>
  );
}
