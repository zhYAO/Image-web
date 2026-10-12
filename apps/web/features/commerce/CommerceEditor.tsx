"use client";

import { useState, type ReactNode } from "react";
import { Image as Preview, Modal } from "antd";
import Image from "next/image";
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  ImagePlus,
  Minus,
  Plus,
  Upload,
  X,
} from "lucide-react";
import {
  DETAIL_MODULES,
  SELLING_LAYOUTS,
  templatesForScene,
  type CommerceBrief,
  type CommercePlan,
  type CommerceScene,
  type CommerceSlot,
  type CreativeTextOptimizeRequest,
  type ProviderCapability,
  type UploadReference,
} from "@zimage/domain";
import { CommerceSelect } from "./CommerceSelect";
import { CreativeTextField } from "./CreativeTextField";
import styles from "./meitu.module.css";

type Settings = Pick<
  CommerceSlot,
  "provider" | "model" | "aspectRatio" | "resolution"
>;
type Counts = Record<"white" | "selling" | "scene" | "other", number>;
export interface CommerceEditorProps {
  referenceSource: "files" | "url";
  setReferenceSource: (value: "files" | "url") => void;
  sceneTab: "templates" | "custom" | "reference";
  setSceneTab: (value: "templates" | "custom" | "reference") => void;
  referenceInstruction: (ref: UploadReference) => string;
  setReferenceInstruction: (ref: UploadReference, value: string) => void;
  scene: CommerceScene;
  brief: CommerceBrief;
  patch: (patch: Partial<CommerceBrief>) => void;
  references: UploadReference[];
  roleOf: (reference: UploadReference) => "product" | "style";
  addFiles: (files: FileList, role: "product" | "style") => void;
  remove: (index: number) => void;
  settings: Settings;
  capabilities: ProviderCapability[];
  changeSettings: (patch: Partial<Settings>) => void;
  setPlatform: (value: string) => void;
  setRegion: (value: string) => void;
  setLanguage: (value: string) => void;
  templateId: string;
  setTemplate: (value: string) => void;
  count: number;
  setCount: (value: number) => void;
  counts: Counts;
  setCounts: (value: Counts) => void;
  layouts: string[];
  setLayouts: (value: string[]) => void;
  modules: string[];
  setModules: (value: string[]) => void;
  advanced: boolean;
  setAdvanced: (value: boolean) => void;
  stage: "configure" | "review";
  setStage: (value: "configure" | "review") => void;
  instruction: string;
  setInstruction: (value: string) => void;
  plan?: CommercePlan;
  setPlan: (value: CommercePlan) => void;
  showPlan: boolean;
  selectedSlotId?: string;
  selectSlot: (id: string) => void;
  prepare: () => void;
  save: (generate?: boolean) => void;
  close: () => void;
  importUrl: () => void;
  generateStrategy: () => void;
  generateListing: () => void;
  textFee: ReactNode;
  fee: ReactNode;
  productContext: CreativeTextOptimizeRequest["productContext"];
  chatModel: 'doubao' | 'minimax';
  setChatModel: (value: string) => void;
  busy: boolean;
  recovering: boolean;
  active: boolean;
  error?: string;
  total: number;
  unavailableModel?: boolean;
  resetModel?: () => void;
}

export function CommerceExample({ scene }: { scene: CommerceScene }) {
  const image = (name: string, alt: string, className?: string) => (
    <Image
      key={name}
      className={className}
      src={`/commerce/meitu-v1/${name}.webp`}
      width={720}
      height={720}
      sizes="(max-width: 1400px) 24vw, 30vw"
      alt={alt}
    />
  );
  if (scene === "detail")
    return (
      <div className={`${styles.exampleStage} ${styles.detailExample}`}>
        <div className={styles.exampleOriginal}>
          {image("detail-product", "蓝色耳机商品原图")}
          <span>上传商品图</span>
        </div>
        <ArrowRight aria-hidden />
        <div className={styles.exampleLong}>
          {["hero", "selling", "scene", "angle", "atmosphere", "texture"].map(
            (name) => image(`detail-${name}`, `详情模块示例 ${name}`),
          )}
          <span>生成电商长图</span>
        </div>
        <div className={styles.exampleModules}>
          {["hero", "selling", "scene", "angle", "atmosphere", "texture"].map(
            (name) => (
              <div key={name}>
                {image(`detail-${name}`, `详情页示例 ${name}`)}
              </div>
            ),
          )}
        </div>
      </div>
    );
  if (scene === "clone")
    return (
      <div className={`${styles.exampleStage} ${styles.cloneExample}`}>
        <div>
          {image("clone-reference", "复刻构图参考")}
          <span>参考风格</span>
        </div>
        <ArrowRight aria-hidden />
        <div>
          {image("clone-result", "原创商品复刻示意")}
          <span>替换商品与配色</span>
        </div>
      </div>
    );
  if (scene === "product-main")
    return (
      <div className={`${styles.exampleStage} ${styles.shootExample}`}>
        {["product", "studio", "botanical"].map((name, index) => (
          <div key={name}>
            {image(
              `shoot-${name}`,
              ["商品原图", "影棚场景示例", "自然光场景示例"][index]!,
            )}
            <span>{["商品原图", "影棚光影", "自然氛围"][index]}</span>
          </div>
        ))}
      </div>
    );
  return (
    <div className={`${styles.exampleStage} ${styles.kitExample}`}>
      <div className={styles.exampleOriginal}>
        {image("kit-product", "原创橙色耳机商品原图")}
        <span>01 主图 · 白底展示</span>
      </div>
      <ArrowRight aria-hidden />
      <div className={styles.exampleGrid}>
        {["scene", "model", "detail", "selling"].map((name, i) => (
          <div key={name}>
            {image(
              `kit-${name}`,
              ["场景展示", "模特场景", "细节说明", "卖点详解"][i]!,
            )}
            <span>
              0{i + 2} {["场景展示", "模特场景", "细节说明", "卖点详解"][i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  extra,
}: {
  title: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>
        <h2>{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Uploader({
  p,
  role,
  optional,
  title,
  existingOnly = false,
}: {
  p: CommerceEditorProps;
  role: "product" | "style";
  optional?: boolean;
  title: string;
  existingOnly?: boolean;
}) {
  const entries = p.references
    .map((ref, index) => ({ ref, index }))
    .filter(({ ref }) => p.roleOf(ref) === role);
  const max = role === "product" ? 6 : p.scene === "clone" ? 20 : 6;
  const label =
    role === "product"
      ? "上传电商参考图"
      : p.scene === "product-main"
        ? "上传背景参考图"
        : "上传风格参考图";
  return (
    <Section
      title={`${title}${optional ? "（选填）" : ""}`}
      extra={
        <small>
          {entries.length}/{max}
        </small>
      }
    >
      <div
        className={styles.uploadArea}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!existingOnly && !p.busy && !p.recovering)
            p.addFiles(event.dataTransfer.files, role);
        }}
      >
        {entries.length > 0 && (
          <div className={styles.thumbnails}>
            {entries.map(({ ref, index }) => (
              <div key={`${ref.name}:${index}`}>
                {ref.previewUrl ? (
                  <Preview
                    src={ref.previewUrl}
                    width={76}
                    height={76}
                    alt={ref.name}
                  />
                ) : (
                  <ImagePlus aria-hidden />
                )}
                <button
                  type="button"
                  aria-label={`移除参考图 ${index + 1}`}
                  onClick={() => p.remove(index)}
                >
                  <X size={12} />
                </button>
                <small title={ref.name}>{ref.name}</small>
                <CommerceSelect
                  aria-label={`参考图 ${index + 1} 用途`}
                  value={role}
                  disabled
                  onChange={() => {}}
                >
                  <option value="product">真实商品图</option>
                  <option value="style">风格参考图</option>
                </CommerceSelect>
              </div>
            ))}
          </div>
        )}
        {!existingOnly && <label className={styles.uploadButton}>
          <Upload size={16} aria-hidden />
          {entries.length
            ? "继续添加"
            : role === "product"
              ? "上传图片"
              : "上传参考图"}
          <input
            aria-label={label}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              if (event.target.files) p.addFiles(event.target.files, role);
              event.target.value = "";
            }}
          />
        </label>}
        {!existingOnly && <><p>
          {optional
            ? "有商品需替换时上传，无商品可跳过"
            : role === "product"
              ? "同一产品，最多 6 张"
              : `最多 ${max} 张参考图`}
        </p>
        <small>PNG、JPG、WebP · 每张不超过 10 MB</small></>}
      </div>
    </Section>
  );
}

function GenerationSettings({ p }: { p: CommerceEditorProps }) {
  const model = p.capabilities
    .find((c) => c.provider === p.settings.provider)
    ?.models.find((m) => m.id === p.settings.model);
  return (
    <Section title="生成设置">
      <div className={styles.settingGrid}>
        {p.scene === "detail" ? (
          <CommerceSelect
            aria-label="A+ 输出规格"
            value={p.advanced ? "advanced" : "standard"}
            onChange={(value) => p.setAdvanced(value === "advanced")}
          >
            <option value="standard">普通 A+ · 970 × 600</option>
            <option value="advanced">高级 A+ · 桌面 + 移动</option>
          </CommerceSelect>
        ) : (
          <CommerceSelect
            aria-label="电商画面比例"
            value={p.settings.aspectRatio}
            onChange={(value) =>
              p.changeSettings({
                aspectRatio: value as Settings["aspectRatio"],
              })
            }
          >
            {!model?.aspectRatios.includes(p.settings.aspectRatio) && <option disabled>{p.settings.aspectRatio}</option>}
            {model?.aspectRatios.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </CommerceSelect>
        )}
        <CommerceSelect aria-label="电商分辨率" value={p.settings.resolution} onChange={value => p.changeSettings({ resolution: value as Settings['resolution'] })}>
          {!model?.resolutions.includes(p.settings.resolution) && <option disabled>{p.settings.resolution}</option>}
          {model?.resolutions.map(value => <option key={value}>{value}</option>)}
        </CommerceSelect>
      </div>
    </Section>
  );
}

function Description({ p }: { p: CommerceEditorProps }) {
  return (
    <Section title="商品卖点 & 要求">
      <CreativeTextField
        field="description"
        chatModel={p.chatModel}
        label="商品描述"
        productContext={p.productContext}
        value={
          p.brief.description ??
          [p.brief.name, p.brief.facts, p.brief.sellingPoints]
            .filter(Boolean)
            .join("\n")
        }
        onChange={(description) => p.patch({ description })}
        multiline
        rows={5}
        maxLength={4000}
        placeholder={
          "建议包含以下信息生成更精准：\n1. 产品名称\n2. 核心卖点\n3. 适用人群\n4. 期望场景\n5. 已确认的规格"
        }
      />
    </Section>
  );
}

export function ProductSetFlow({ p }: { p: CommerceEditorProps }) {
  const [layoutOpen, setLayoutOpen] = useState(false);
  return (
    <>
      <Uploader p={p} role="product" title="商品原图" />
      {p.references.some(reference => p.roleOf(reference) === 'style') && <Uploader p={p} role="style" title="已保存风格参考" existingOnly />}
      <GenerationSettings p={p} />
      <Description p={p} />
      <Section title="套图结构配置" extra={<small>共 {p.total} 张</small>}>
        {(["white", "selling", "scene", "other"] as const).map((key) => (
          <div className={styles.countCard} key={key}>
            <div className={styles.countRow}>
              <strong>
                {
                  {
                    white: "白底图",
                    selling: "卖点图",
                    scene: "场景图",
                    other: "其他",
                  }[key]
                }
              </strong>
              <div className={styles.stepper}>
                <button
                  type="button"
                  aria-label={`减少${key}图片数量`}
                  disabled={p.counts[key] === 0}
                  onClick={() =>
                    p.setCounts({ ...p.counts, [key]: p.counts[key] - 1 })
                  }
                >
                  <Minus size={13} />
                </button>
                <input
                  aria-label={`${key}图片数量`}
                  type="number"
                  min={0}
                  max={20}
                  value={p.counts[key]}
                  onChange={(event) =>
                    p.setCounts({
                      ...p.counts,
                      [key]: Math.max(
                        0,
                        Math.min(20, Number(event.target.value) || 0),
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`增加${key}图片数量`}
                  disabled={p.total >= 20}
                  onClick={() =>
                    p.setCounts({ ...p.counts, [key]: p.counts[key] + 1 })
                  }
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>
            {key === "selling" && (
              <button
                className={styles.layoutTrigger}
                type="button"
                onClick={() => setLayoutOpen(true)}
              >
                选择卖点图版式参考{" "}
                <span>
                  {p.layouts.filter((l) => l !== "自动分配").length || "自动"}{" "}
                  <ArrowRight size={14} />
                </span>
              </button>
            )}
          </div>
        ))}
      </Section>
      <details className={styles.more}>
        <summary>商品上架文案（可选）</summary>
        <p>依据已填写资料生成，文字费用单独计算。</p>
        {p.textFee}
        <button type="button" onClick={p.generateListing}>
          AI 编写上架文案
        </button>
        {(["title", "highlights", "description", "keywords"] as const).map(
          (key) => (
            <label key={key}>
              {
                {
                  title: "标题",
                  highlights: "核心卖点",
                  description: "详情描述",
                  keywords: "关键词",
                }[key]
              }
              <textarea
                aria-label={`上架文案${key}`}
                rows={3}
                maxLength={
                  key === "description"
                    ? 4000
                    : key === "highlights"
                      ? 2000
                      : key === "title"
                        ? 300
                        : 1000
                }
                value={p.brief.listingCopy?.[key] ?? ""}
                onChange={(event) =>
                  p.patch({
                    listingCopy: {
                      title: "",
                      highlights: "",
                      description: "",
                      keywords: "",
                      ...p.brief.listingCopy,
                      [key]: event.target.value,
                    },
                  })
                }
              />
            </label>
          ),
        )}
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(
              Object.values(p.brief.listingCopy ?? {}).join("\n"),
            )
          }
        >
          复制文案
        </button>
      </details>
      <Modal
        title="选择卖点图版式参考"
        open={layoutOpen}
        onCancel={() => setLayoutOpen(false)}
        onOk={() => setLayoutOpen(false)}
        okText="完成"
        cancelButtonProps={{ style: { display: "none" } }}
        width={720}
        className={styles.layoutModal}
      >
        <p>为每张卖点图指定版式，生成时将使用对应构图要求。</p>
        {Array.from({ length: p.counts.selling }, (_, i) => (
          <label className={styles.layoutLabel} key={i}>
            卖点图 {i + 1}
            <CommerceSelect
              aria-label={`卖点图 ${i + 1} 版式`}
              value={p.layouts[i] ?? "自动分配"}
              onChange={(value) => {
                const next = [...p.layouts];
                next[i] = value;
                p.setLayouts(next);
              }}
            >
              {SELLING_LAYOUTS.map((layout) => (
                <option key={layout}>{layout}</option>
              ))}
            </CommerceSelect>
          </label>
        ))}
      </Modal>
    </>
  );
}

export function DetailFlow({ p }: { p: CommerceEditorProps }) {
  if (p.stage === "review")
    return (
      <>
        <Section title="模块策略与设计规范">
          <p>{p.brief.description || p.brief.name}</p>
          {p.textFee}
          <button type="button" onClick={p.generateStrategy}>
            AI 生成视觉策略与模块文案
          </button>
          <label>
            视觉策略
            <textarea
              aria-label="视觉策略"
              value={p.brief.visualStrategy ?? ""}
              maxLength={2000}
              rows={4}
              onChange={(event) =>
                p.patch({ visualStrategy: event.target.value })
              }
            />
          </label>
        </Section>
        <Section title="模块内容" extra={<small>可编辑、排序</small>}>
          {p.modules.map((module, index) => (
            <article className={styles.moduleReview} key={module}>
              <div>
                <strong>
                  {String(index + 1).padStart(2, "0")} · {module}
                </strong>
                <span>
                  {[-1, 1].map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      aria-label={`${direction < 0 ? "上移" : "下移"}${module}`}
                      disabled={
                        index + direction < 0 ||
                        index + direction >= p.modules.length
                      }
                      onClick={() => {
                        const next = [...p.modules];
                        [next[index], next[index + direction]] = [
                          next[index + direction]!,
                          next[index]!,
                        ];
                        p.setModules(next);
                      }}
                    >
                      {direction < 0 ? (
                        <ArrowUp size={14} />
                      ) : (
                        <ArrowDown size={14} />
                      )}
                    </button>
                  ))}
                </span>
              </div>
              <textarea
                aria-label={`${module}模块文案`}
                rows={3}
                maxLength={1000}
                placeholder="填写该模块要呈现的文案；留空由商品资料生成"
                value={p.brief.moduleCopy?.[module] ?? ""}
                onChange={(event) =>
                  p.patch({
                    moduleCopy: {
                      ...p.brief.moduleCopy,
                      [module]: event.target.value,
                    },
                  })
                }
              />
            </article>
          ))}
        </Section>
      </>
    );
  return (
    <>
      <Uploader p={p} role="product" title="商品原图" />
      <GenerationSettings p={p} />
      <Description p={p} />
      <Section
        title="包含模块（多选）"
        extra={<small>已选 {p.modules.length} 项</small>}
      >
        <div className={styles.moduleGrid}>
          {DETAIL_MODULES.map((module) => (
            <label
              className={
                p.modules.includes(module) ? styles.moduleSelected : ""
              }
              key={module}
            >
              <input
                type="checkbox"
                checked={p.modules.includes(module)}
                onChange={(event) =>
                  p.setModules(
                    event.target.checked
                      ? [...p.modules, module]
                      : p.modules.filter((m) => m !== module),
                  )
                }
              />
              <strong>{module}</strong>
              <small>围绕{module}呈现商品信息</small>
              {p.modules.includes(module) && <Check size={14} aria-hidden />}
            </label>
          ))}
        </div>
      </Section>
    </>
  );
}

export function CloneFlow({ p }: { p: CommerceEditorProps }) {
  const source = p.referenceSource;
  const setSource = p.setReferenceSource;
  return (
    <>
      <Section title="参考内容">
        <div className={styles.segments}>
          <button
            type="button"
            aria-pressed={source === "files"}
            onClick={() => setSource("files")}
          >
            上传参考图
          </button>
          <button
            type="button"
            aria-pressed={source === "url"}
            onClick={() => setSource("url")}
          >
            导入链接
          </button>
        </div>
        {source === "files" ? (
          <Uploader p={p} role="style" title="复刻参考图" />
        ) : (
          <label>
            公开商品链接
            <input
              aria-label="公开商品链接"
              type="url"
              value={p.brief.sourceUrl ?? ""}
              placeholder="https://"
              onChange={(event) => p.patch({ sourceUrl: event.target.value })}
            />
            <button
              type="button"
              onClick={p.importUrl}
              disabled={!p.brief.sourceUrl}
            >
              从链接导入参考图
            </button>
            <small>仅导入公开图片，无法读取时可切换为手动上传。</small>
          </label>
        )}
      </Section>
      <Uploader p={p} role="product" optional title="产品原图" />
      <Section title="复刻程度">
        <div className={styles.cloneModes}>
          {(["style", "faithful"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={p.brief.cloneMode === value}
              onClick={() => p.patch({ cloneMode: value })}
            >
              <strong>{value === "style" ? "参考风格" : "高度复刻"}</strong>
              <small>
                {value === "style"
                  ? "参考整体风格与结构，重新演绎场景。"
                  : "参照构图和版式，替换商品与文案。"}
              </small>
            </button>
          ))}
        </div>
      </Section>
      <CreativeTextField
        field="instruction"
        label="统一复刻要求（选填）"
        chatModel={p.chatModel}
        multiline
        maxLength={2000}
        value={p.instruction}
        onChange={p.setInstruction}
        productContext={p.productContext}
      />
      <Section title="逐图要求（选填）">
        {p.references
          .filter((ref) => p.roleOf(ref) === "style")
          .map((ref, index) => (
            <label key={`${ref.name}:${index}`}>
              参考图 {index + 1} · {ref.name}
              <textarea
                aria-label={`参考图 ${index + 1} 要求`}
                value={p.referenceInstruction(ref)}
                maxLength={2000}
                rows={2}
                placeholder="补充这张图的替换内容、排版或颜色要求"
                onChange={(event) =>
                  p.setReferenceInstruction(ref, event.target.value)
                }
              />
            </label>
          ))}
      </Section>
      <GenerationSettings p={p} />
      <Description p={p} />
    </>
  );
}

export function ProductImageFlow({ p }: { p: CommerceEditorProps }) {
  const mode = p.sceneTab;
  const setMode = p.setSceneTab;
  return (
    <>
      <Uploader p={p} role="product" title="商品原图" />
      <Section title="选择场景">
        <div className={styles.segments}>
          {[
            ["templates", "推荐场景"],
            ["custom", "自定义"],
            ["reference", "参考图"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => setMode(id as CommerceEditorProps["sceneTab"])}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "templates" && (
          <div className={styles.sceneGrid}>
            {templatesForScene(p.scene).map((template) => (
              <button
                key={template.id}
                type="button"
                aria-pressed={p.templateId === template.id}
                onClick={() => p.setTemplate(template.id)}
              >
                {["white-main", "soft-studio", "daily-scene"].includes(
                  template.id,
                ) && (
                  <Image
                    src={`/commerce/meitu-v1/shoot-${template.id === "white-main" ? "product" : template.id === "daily-scene" ? "botanical" : "studio"}.webp`}
                    width={240}
                    height={240}
                    alt={`${template.name}场景示意`}
                  />
                )}
                <strong>{template.name}</strong>
                <small>{template.guidance}</small>
              </button>
            ))}
          </div>
        )}
        {mode === "custom" && (
          <CreativeTextField
            field="instruction"
            label="场景描述"
            chatModel={p.chatModel}
            value={p.instruction}
            onChange={p.setInstruction}
            multiline
            maxLength={2000}
            productContext={p.productContext}
          />
        )}
        {mode === "reference" && (
          <Uploader p={p} role="style" title="背景参考图" />
        )}
      </Section>
      <GenerationSettings p={p} />
      <label>
        生成数量
        <CommerceSelect
          aria-label="方案图片数量"
          value={p.count}
          onChange={(value) => p.setCount(Number(value))}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </CommerceSelect>
      </label>
      <Description p={p} />
    </>
  );
}

export function CommerceEditor(p: CommerceEditorProps) {
  const isDetail = p.scene === "detail";
  const title =
    p.scene === "product-set"
      ? "AI商品套图"
      : isDetail
        ? "A+/详情页"
        : p.scene === "clone"
          ? "爆款图复刻"
          : "AI商品图";
  const product = p.references.find((ref) => p.roleOf(ref) === "product");
  const hasInput = p.references.some(
    (ref) => p.roleOf(ref) === (p.scene === "clone" ? "style" : "product"),
  );
  const blocked =
    p.busy ||
    (!p.capabilities.length && !p.recovering) ||
    (p.unavailableModel && !p.recovering) ||
    !p.active ||
    !hasInput ||
    p.total < 1 ||
    p.total > (isDetail ? 32 : p.scene === "product-main" ? 4 : 20);
  const firstUpload = p.scene === "product-main" && !product;
  return (
    <section
      className={`${styles.editor} ${isDetail ? styles.detailEditor : ""} ${firstUpload ? styles.firstUpload : ""}`}
      aria-label={`${p.scene === "product-set" ? "商品套图" : p.scene === "product-main" ? "AI 商品图" : title}向导`}
    >
      <div className={styles.config} hidden={firstUpload}>
        <div className={styles.configScroll}>
          <fieldset disabled={p.busy || p.recovering}>
            {p.scene === "product-set" ? (
              <ProductSetFlow p={p} />
            ) : isDetail ? (
              <DetailFlow p={p} />
            ) : p.scene === "clone" ? (
              <CloneFlow p={p} />
            ) : (
              <ProductImageFlow p={p} />
            )}
          </fieldset>
        </div>
        <footer className={styles.actionBar}>
          {p.unavailableModel && <p role="alert">历史图片模型已停止新生成，请主动更新为 Seedream 5.0 Pro 并保存新版本。<button type="button" disabled={p.busy || p.recovering} onClick={p.resetModel}>使用当前默认参数创建新版本</button></p>}
          {p.error && (
            <p role="alert" className={styles.error}>
              {p.error}
            </p>
          )}
          {p.recovering && <small>已保存恢复身份，重试将继续同一任务。</small>}
          <div className={styles.fee}>
            <span>{p.total} 张图片</span>
            {p.fee}
          </div>
          <div className={styles.footerPrimary}>
            {isDetail && p.stage === "review" && (
              <button
                type="button"
                disabled={p.busy}
                onClick={() => p.setStage("configure")}
              >
                上一步
              </button>
            )}
            <button
              className={styles.primary}
              disabled={blocked}
              onClick={() =>
                isDetail && p.stage === "configure"
                  ? p.setStage("review")
                  : p.save(true)
              }
            >
              {p.busy
                ? "正在准备…"
                : !hasInput
                  ? p.scene === "clone"
                    ? "请上传复刻参考图"
                    : "请上传产品图"
                  : isDetail && p.stage === "configure"
                    ? `下一步：确认模块内容（${p.modules.length}项）`
                    : `一键生成 ${p.total} 张`}
            </button>
          </div>
          <div className={styles.secondaryActions}>
            <button
              disabled={p.busy || !p.active || (!p.capabilities.length && !p.recovering) || (p.unavailableModel && !p.recovering)}
              onClick={() => p.save(false)}
            >
              保存草稿
            </button>
            <button disabled={p.busy} onClick={p.close}>
              取消方案
            </button>
          </div>
        </footer>
      </div>
      <aside className={styles.preview} aria-label="电商方案预览">
        {firstUpload ? (
          <div className={styles.uploadWelcome}>
            <div className={styles.welcomeArt}>
              <Image
                src="/commerce/meitu-v1/shoot-product.webp"
                alt="原创商品摄影示例"
                width={140}
                height={140}
              />
            </div>
            <h1>上传或拖放图片至此处，开始创作</h1>
            <Uploader p={p} role="product" title="上传商品原图" />
            <p>选一个场景，让商品自然融入画面。</p>
            {p.error && (
              <p role="alert" className={styles.error}>
                {p.error}
              </p>
            )}
          </div>
        ) : (
          <>
            {p.scene === "product-main" && product?.previewUrl ? (
              <>
                <div className={styles.canvasToolbar}>
                  <span>画面比例 {p.settings.aspectRatio}</span>
                  <span>原图预览 · {p.count} 张候选</span>
                </div>
                <div className={styles.productCanvas}>
                  <Preview src={product.previewUrl} alt="商品原图" />
                </div>
              </>
            ) : (
              <>
                <div className={styles.previewIntro}>
                  <h1>{title}</h1>
                  <p>
                    {p.scene === "clone" ? (
                      "上传参考图，保留喜欢的视觉风格，创作你的商品图。"
                    ) : (
                      <>
                        上传商品图，AI 即刻生成{" "}
                        <em>
                          {isDetail
                            ? "适合不同平台的专业详情页"
                            : "风格统一的电商商品套图"}
                        </em>
                      </>
                    )}
                  </p>
                </div>
                <CommerceExample scene={p.scene} />
                <p className={styles.exampleCaption}>
                  原创 AI 示例 · 用于展示构图与风格，以实际生成效果为准
                </p>
              </>
            )}
          </>
        )}
      </aside>
    </section>
  );
}
