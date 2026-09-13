import { CommerceSelect } from "./CommerceSelect";
import {
  buildCommerceSlots,
  COMMERCE_PLATFORMS,
  COMMERCE_SCENES,
  COMMERCE_TEMPLATES,
  templatesForScene,
  nextCommerceQuestion,
  validateCommercePlan,
  type CommerceBrief,
  type CommerceGateway,
  type CommercePlan,
  type CommerceScene,
  type CommerceSlot,
  type CommerceTask,
  type ProviderCapability,
  type UploadReference,
} from "@zimage/domain";
import { Image as AntdImage } from "antd";
import { Layers3 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { CommercePlanFields } from "./CommercePlanFields";
import { defaultTemplate } from "./commerce-ui";
import styles from "./commerce.module.css";
import { TemplatePreview } from "./TemplatePreview";
import { CreativeTextField } from "./CreativeTextField";

export interface CommerceWizardProps {
  active?: boolean;
  embedded?: boolean;
  rightHeader?: ReactNode;
  previewPanel?: "examples" | "plan";
  onPreview?: () => void;
  seedPlan?: CommercePlan;
  initialTemplateId?: string;
  promotedStyleIds?: string[];
  scene: CommerceScene;
  platform?: CommerceBrief["platform"];
  prompt?: string;
  sessionId: string;
  gateway?: CommerceGateway;
  references: UploadReference[];
  capabilities: ProviderCapability[];
  settings: Pick<
    CommerceSlot,
    "provider" | "model" | "aspectRatio" | "resolution"
  >;
  onReferenceAdd: (files: FileList) => void;
  onReferenceRemove: (index: number) => void;
  onReferenceUploaded: (
    reference: UploadReference,
    id: string,
    sessionId: string,
  ) => void;
  onSaved: (task: CommerceTask, generate?: boolean) => void;
  onClose: () => void;
}

export function CommerceWizard({
  active = true,
  embedded = false,
  rightHeader,
  previewPanel,
  onPreview,
  scene,
  seedPlan,
  initialTemplateId,
  promotedStyleIds = [],
  platform = "taobao",
  prompt = "",
  sessionId,
  gateway,
  references,
  capabilities,
  settings,
  onReferenceAdd,
  onReferenceRemove,
  onReferenceUploaded,
  onSaved,
  onClose,
}: CommerceWizardProps) {
  const definition = COMMERCE_SCENES.find((item) => item.id === scene)!;
  const isPoster = scene === "xhs-poster";
  const [step, setStep] = useState(1);
  const [brief, setBrief] = useState<CommerceBrief>(
    seedPlan?.brief ?? {
      name: "",
      facts: "",
      sellingPoints: "",
      platform: isPoster ? "xiaohongshu" : platform,
      contentMode: isPoster ? "content" : "product",
      placement: (isPoster || scene === "social") ? "图文内容" : "商品展示",
      productReferenceIds: [],
      styleReferenceIds: [],
    },
  );
  const contentOnly = isPoster && brief.contentMode === "content";
  const [roles, setRoles] = useState<Record<string, "product" | "style">>({});
  const [count, setCount] = useState<number>(
    seedPlan?.slots.length ?? definition.count,
  );
  const [templateId, setTemplateId] = useState(
    seedPlan?.templateId ?? (templatesForScene(scene).some(item => item.id === initialTemplateId) ? initialTemplateId! : defaultTemplate(scene)),
  );
  const [instruction, setInstruction] = useState(
    prompt || seedPlan?.slots[0]?.instruction || "",
  );
  const [lastBuiltInstruction, setLastBuiltInstruction] = useState(
    seedPlan?.slots[0]?.instruction ?? "",
  );
  const [preparedSignature, setPreparedSignature] = useState<string>();
  const [seenPrompt, setSeenPrompt] = useState(prompt);
  const [plan, setPlan] = useState<CommercePlan | undefined>(seedPlan);
  const promotedKey = promotedStyleIds.join("|");
  const [seenPromotion, setSeenPromotion] = useState(promotedKey);
  if (seenPromotion !== promotedKey) {
    setSeenPromotion(promotedKey);
    setStep(1);
  }
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState(seedPlan?.slots[0]?.id);
  const showPlan = step === 3 && plan && previewPanel !== "examples";
  if (seenPrompt !== prompt) {
    setSeenPrompt(prompt);
    setInstruction((current) => [current, prompt].filter(Boolean).join("\n"));
    if (step === 3) setStep(1);
  }

  const uploadIds = useRef(new Map<UploadReference, string>());
  const createRequest = useRef<{ key: string; requestId: string } | undefined>(
    undefined,
  );
  const locked = useRef(false);
  const referenceKey = (reference: UploadReference) =>
    reference.previewUrl ?? reference.id ?? reference.name;
  const roleOf = (reference: UploadReference) =>
    contentOnly ? "style" : roles[referenceKey(reference)] ??
    (reference.id &&
    [
      ...promotedStyleIds,
      ...(seedPlan?.brief.styleReferenceIds ?? []),
    ].includes(reference.id)
      ? "style"
      : "product");
  const referenceSignature = JSON.stringify(
    references.map((reference) => [referenceKey(reference), roleOf(reference)]),
  );
  // Upload completion supplies an ID for the same file; previewUrl keeps that identity stable.
  if (
    active &&
    preparedSignature &&
    preparedSignature !== referenceSignature &&
    step > 1
  ) {
    setStep(1);
    setError("共享参考图或用途已变化，请重新确认商品资料，再生成分图方案。");
  }
  const requirePreparedReferences = () => {
    if (!active || preparedSignature !== referenceSignature)
      throw new Error(
        "共享参考图或用途已变化，请重新确认商品资料，再生成分图方案。",
      );
  };
  const invalidatePreview = () => {
    if (step === 3) {
      setStep(1);
      setError("方案资料已修改，请重新预览分图方案后再确认。");
    }
  };
  const patch = (value: Partial<CommerceBrief>) => {
    invalidatePreview();
    setBrief((current) => ({ ...current, ...value }));
  };
  const act = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "方案操作失败，请重试。",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const prepare = () =>
    act(async () => {
      if (!gateway) throw new Error("电商服务暂未连接，请稍后重试。");
      // Ask exactly one blocking question before spending an upload request.
      if (!contentOnly && !references.some((reference) => roleOf(reference) === "product"))
        throw new Error("请上传至少一张清晰的真实商品图。");
      if (!brief.name.trim()) throw new Error(contentOnly ? "请填写海报标题。" : "这个商品的名称是什么？");
      if (
        scene === "style-reference" &&
        !references.some((reference) => roleOf(reference) === "style")
      )
        throw new Error("请添加一张风格参考图。");
      const productReferenceIds: string[] = [];
      const styleReferenceIds: string[] = [];
      for (const reference of references) {
        if (reference.status !== "ready")
          throw new Error("请等待参考图上传完成，或移除失败图片后重试。");
        let id = reference.id ?? uploadIds.current.get(reference);
        if (!id) {
          const { previewUrl: _preview, ...upload } = reference;
          void _preview;
          id = await gateway.upload(sessionId, upload);
          uploadIds.current.set(reference, id);
          onReferenceUploaded(reference, id, sessionId);
        }
        (roleOf(reference) === "style"
          ? styleReferenceIds
          : productReferenceIds
        ).push(id);
      }
      const complete = { ...brief, productReferenceIds, styleReferenceIds };
      const question = nextCommerceQuestion(complete, scene);
      if (question) throw new Error(question);
      setBrief(complete);
      setPreparedSignature(referenceSignature);
      const nextPlan = makePlan(complete);
      setSelectedSlotId((current) =>
        nextPlan.slots.some((slot) => slot.id === current)
          ? current
          : nextPlan.slots[0]?.id,
      );
      setStep(3);
      onPreview?.();
    });
  const makePlan = (preparedBrief: CommerceBrief) => {
    const generatedExactText = (source: CommerceBrief, role: string) => {
      if (["商品主图", "使用场景", "生活场景", "模特展示", "风格创作"].includes(role)) return "";
      const points = source.sellingPoints.split(/\n|[；;]/).map(s => s.trim()).filter(Boolean);
      const detail = ["材质细节", "商品说明", "细节说明"].includes(role) ? source.facts : role === "核心卖点" ? points.slice(0, 3).join("\n") : points[0];
      return [source.name, detail].filter(Boolean).join("\n");
    };
    const slots = buildCommerceSlots(preparedBrief, scene, count, isPoster ? { ...settings, aspectRatio: "3:4", resolution: "2K" } : settings).map(
      (slot, index) => {
        const previous = plan?.slots[index];
        const previousGeneratedText = previous
          ? (isPoster ? buildCommerceSlots(plan!.brief, scene, plan!.slots.length, settings)[index]?.exactText : generatedExactText(plan!.brief, previous.role))
          : undefined;
        return {
          ...slot,
          ...previous,
          exactText:
            previous && previous.exactText !== previousGeneratedText
              ? previous.exactText
              : isPoster ? slot.exactText : generatedExactText(preparedBrief, previous?.role ?? slot.role),
          instruction:
            previous && previous.instruction !== lastBuiltInstruction
              ? previous.instruction
              : instruction,
          referenceIds: [
            ...preparedBrief.productReferenceIds,
            ...preparedBrief.styleReferenceIds,
          ],
        };
      },
    );
    const nextPlan = { scene, brief: preparedBrief, templateId, slots };
    validateCommercePlan(preparedBrief, scene, slots, templateId);
    setPlan(nextPlan);
    setLastBuiltInstruction(instruction);
    return nextPlan;
  };
  const savePlan = async (nextPlan: CommercePlan, generate: boolean) => {
    if (!gateway) throw new Error("电商服务暂未连接，请稍后重试。");
    validateCommercePlan(
      nextPlan.brief,
      nextPlan.scene,
      nextPlan.slots,
      nextPlan.templateId,
    );
    const key = JSON.stringify(nextPlan);
    if (createRequest.current?.key !== key)
      createRequest.current = { key, requestId: crypto.randomUUID() };
    const task = await gateway.create({
      sessionId,
      plan: nextPlan,
      requestId: createRequest.current.requestId,
    });
    onSaved(task, generate);
  };
  const save = (generate = false) =>
    act(async () => {
      if (!gateway || !plan) return;
      requirePreparedReferences();
      await savePlan(plan, generate);
    });
  return (
    <section
      aria-label={`${definition.name}向导`}
      className={`${styles.wizard} ${styles.wizardWorkbench} ${embedded ? styles.wizardEmbedded : ""}`}
    >
      <div className={styles.heading}>
        <h2>{definition.name}</h2>
        <button onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? "展开资料" : "收起资料"}
        </button>
      </div>
      {!collapsed && (
        <div className={styles.wizardColumns}>
          <div className={styles.wizardSettings}>
            <div className={styles.wizardFormScroll}>
              <fieldset disabled={busy} className={styles.formBody}>
                <>
                  {isPoster && <label>内容类型<CommerceSelect aria-label="海报内容类型" value={brief.contentMode ?? "product"} onChange={(value) => patch({ contentMode: value as "product" | "content" })}><option value="content">通用内容</option><option value="product">商品种草</option></CommerceSelect></label>}
                  <p>{contentOnly ? "填写标题与正文，选择风格制作海报。多张内容请按段落分行。" : "上传商品图，填写名称，即可开始。卖点和风格可按需补充。"}</p>
                  <label>
                    {contentOnly ? "风格参考图（选填）" : "商品与风格图片"}
                    <input
                      aria-label="上传电商参考图"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      onChange={(event) => {
                        if (event.target.files)
                          onReferenceAdd(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  <p className={styles.note}>
                    合计最多 4 张，每张不超过 10 MB。
                  </p>
                  <div className={styles.references}>
                    {references.map((reference, index) => (
                      <div key={referenceKey(reference)}>
                        {reference.previewUrl && (
                          <AntdImage
                            width={80}
                            height={80}
                            src={reference.previewUrl}
                            alt={reference.name}
                          />
                        )}
                        <span>{reference.name}</span>
                        <label>
                          素材用途
                          <CommerceSelect
                            aria-label={`参考图 ${index + 1} 用途`}
                            disabled={
                              contentOnly || busy ||
                              Boolean(
                                reference.id &&
                                promotedStyleIds.includes(reference.id),
                              )
                            }
                            value={roleOf(reference)}
                            onChange={(value) => {
                              invalidatePreview();
                              setRoles({
                                ...roles,
                                [referenceKey(reference)]: value as
                                  "product" | "style",
                              });
                            }}
                          >
                            <option value="product">真实商品图</option>
                            <option value="style">风格参考图</option>
                          </CommerceSelect>
                        </label>
                        <button onClick={() => onReferenceRemove(index)}>
                          移除参考图 {index + 1}
                        </button>
                      </div>
                    ))}
                  </div>
                  <CreativeTextField field={contentOnly ? "title" : "name"} label={contentOnly ? "海报标题" : "商品名称"} maxLength={160} value={brief.name} onChange={(name) => patch({ name })} />
                  <div className={styles.twoColumns}>
                    <label>
                      平台
                      <CommerceSelect
                        disabled={busy || isPoster}
                        aria-label="创作平台"
                        value={brief.platform}
                        onChange={(value) =>
                          patch({
                            platform: value as CommerceBrief["platform"],
                          })
                        }
                      >
                        {COMMERCE_PLATFORMS.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </CommerceSelect>
                    </label>
                    <label>
                      用途
                      <CommerceSelect
                        disabled={busy}
                        aria-label="创作用途"
                        value={brief.placement}
                        onChange={(value) => patch({ placement: value })}
                      >
                        <option>商品展示</option>
                        <option>图文内容</option>
                        <option>商品详情</option>
                      </CommerceSelect>
                    </label>
                  </div>
                  {contentOnly ? <CreativeTextField field="content" label="海报内容" maxLength={4000} multiline rows={6} value={brief.facts} onChange={(facts) => patch({ facts })} context={brief.name} placeholder="填写要呈现的内容，多张卡片请按段落分行" /> : <>
                  <details className={styles.advancedOptions}>
                    <summary>商品事实（选填）</summary>
                    <CreativeTextField field="facts" label="商品事实" maxLength={4000} multiline value={brief.facts} onChange={(facts) => patch({ facts })} context={brief.name} placeholder="仅填写已确认的外观、材质与规格" />
                  </details>
                  <CreativeTextField field="sellingPoints" label="商品卖点" maxLength={2000} multiline value={brief.sellingPoints} onChange={(sellingPoints) => patch({ sellingPoints })} context={`${brief.name}\n${brief.facts}`} />
                  </>}
                </>
                <>
                  <label>
                    风格方向
                    <CommerceSelect
                      disabled={busy}
                      aria-label="风格模板"
                      value={templateId}
                      onChange={(value) => {
                        invalidatePreview();
                        setTemplateId(value);
                      }}
                    >
                      {!templatesForScene(scene).some(item => item.id === templateId) && <option value={templateId}>历史模板 · {COMMERCE_TEMPLATES.find(item => item.id === templateId)?.name ?? templateId}</option>}
                      {templatesForScene(scene).map(
                        (item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ),
                      )}
                    </CommerceSelect>
                  </label>
                  <p>
                    {
                      COMMERCE_TEMPLATES.find((item) => item.id === templateId)
                        ?.guidance
                    }{" "}
                  </p>
                  <label>
                    图片数量
                    <CommerceSelect
                      disabled={busy}
                      aria-label="方案图片数量"
                      value={count}
                      onChange={(value) => {
                        invalidatePreview();
                        setCount(Number(value));
                      }}
                    >
                      {Array.from({ length: 8 }, (_, index) => (
                        <option key={index + 1}>{index + 1}</option>
                      ))}
                    </CommerceSelect>
                  </label>
                  <details className={styles.advancedOptions}>
                    <summary>高级设置 · 配色、场景与约束</summary>
                    <CreativeTextField field="instruction" label="整套创作要求" multiline maxLength={2000} value={instruction} context={`${brief.name}\n${brief.facts}`} onChange={(value) => { invalidatePreview(); setInstruction(value); }} />
                  </details>
                  <p>
                    建议角色：{definition.roles.join("、")}
                    ；也可展开逐图设置调整。
                  </p>
                </>
              </fieldset>
            </div>
            {error && <p role="alert">{error}</p>}
            <div className={`${styles.actions} ${styles.wizardControls}`}>
              <p className={styles.note}>
                本次生成 {step === 3 ? plan?.slots.length : count}{" "}
                张，消耗同等图片额度
              </p>
              {step !== 3 && (
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void prepare()}
                >
                  {busy ? "正在准备…" : "预览分图方案"}
                </button>
              )}
              {step === 3 && (
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void save(true)}
                >
                  {busy
                    ? "正在准备…"
                    : `确认生成 ${plan?.slots.length ?? count} 张`}
                </button>
              )}
              {step === 3 && (
                <button
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy ? "正在保存…" : "保存方案，稍后生成"}
                </button>
              )}
              <button disabled={busy} onClick={onClose}>
                取消未保存方案
              </button>
            </div>
          </div>
          <aside aria-label="电商方案预览" className={styles.wizardPreview}>
            {rightHeader && (
              <div className={styles.wizardRightHeader}>{rightHeader}</div>
            )}
            <div className={styles.previewHeading}>
              <span>
                <Layers3 aria-hidden size={16} />
                {showPlan
                  ? "编辑分图方案"
                  : previewPanel === "plan"
                    ? "分图方案"
                    : "效果示例"}
              </span>
              <span>{count} 张图片</span>
            </div>
            {showPlan ? (
              <fieldset disabled={busy} className={styles.formBody}>
                <CommercePlanFields
                  disabled={busy}
                  plan={plan}
                  capabilities={capabilities}
                  onChange={setPlan}
                  selectedSlotId={selectedSlotId}
                  onSelectSlot={setSelectedSlotId}
                />
              </fieldset>
            ) : previewPanel === "plan" ? (
              <>
                <h3>预览你的分图方案</h3>
                <p className={styles.note}>
                  填写或更新左侧商品资料后，点击“预览分图方案”。这里会展示每张图片的角色、准确文案与构图要求，确认前不会开始生成。
                </p>
              </>
            ) : (
              <>
                <h3>{brief.name || definition.name}</h3>
                <p className={styles.note}>
                  参考这些效果填写商品资料；生成后在这里查看、修改和下载。
                </p>
                <div className={styles.structureGrid}>
                  {Array.from({ length: count }, (_, index) => (
                    <div className={styles.structureCard} key={index}>
                      <span className={styles.structureNumber}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <TemplatePreview templateId={templateId} role={isPoster ? (index === 0 ? "海报封面" : "内容卡片") : definition.roles[index % definition.roles.length]} />
                      <strong>
                        {isPoster ? (index === 0 ? "海报封面" : "内容卡片") : definition.roles[index % definition.roles.length]}
                      </strong>
                      <small>示例 · 以实际生成为准</small>
                    </div>
                  ))}
                </div>
                <p className={styles.note}>
                  预览对应所选模板的视觉方向，不是你的生成结果；其他分图按各自角色布局呈现。
                </p>
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
