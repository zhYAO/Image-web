import { useCredits, CreditFee } from "@/features/credits/CreditsProvider";
import { imageCreditItem } from "@zimage/domain";
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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CommercePlanFields } from "./CommercePlanFields";
import { defaultTemplate } from "./commerce-ui";
import styles from "./commerce.module.css";
import { TemplatePreview } from "./TemplatePreview";
import { loadCommerceDraft, saveCommerceDraft, clearCommerceDraft, type CommerceDraftState } from "./commerce-draft-storage";
import { submitCommerceOnce } from "./commerce-submission";
import { isLocalCommerceDraft } from "@/features/workspace/workspace-route";
import { notifyCreditsChanged } from "@/gateways/mock-credit-ledger";
import { CreativeTextField } from "./CreativeTextField";
import { useWorkspaceStore } from "@/store/workspace-store";

export interface CommerceWizardProps {
  active?: boolean;
  ensureSession?: (title: string, requestId: string) => Promise<string>;
  draftKey?: string;
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
  ensureSession,
  draftKey,
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
  const credits = useCredits();
  const selectedChatModel = useWorkspaceStore(state => state.selectedChatModel);
  const setSelectedChatModel = useWorkspaceStore(state => state.setSelectedChatModel);
  const storageKey = draftKey ?? sessionId;
  const [restored] = useState(() => loadCommerceDraft(storageKey));
  const remoteSession = useRef(restored?.sessionId);
  const [generationSettings, setGenerationSettings] = useState(restored?.settings ?? settings);
  const [step, setStep] = useState(1);
  const [brief, setBrief] = useState<CommerceBrief>(
    restored?.brief ?? seedPlan?.brief ?? {
      name: "",
      facts: "",
      sellingPoints: "",
      platform: isPoster ? "xiaohongshu" : platform,
      contentMode: isPoster ? "content" : "product",
      placement: isPoster || scene === "social" ? "图文内容" : "商品展示",
      productReferenceIds: [],
      styleReferenceIds: [],
    },
  );
  const contentOnly = isPoster && brief.contentMode === "content";
  const [roles, setRoles] = useState<Record<string, "product" | "style">>(restored?.roles ?? {});
  const [count, setCount] = useState<number>(
    restored?.count ?? seedPlan?.slots.length ?? definition.count,
  );
  const [templateId, setTemplateId] = useState(
    restored?.templateId ?? seedPlan?.templateId ??
      (templatesForScene(scene).some((item) => item.id === initialTemplateId)
        ? initialTemplateId!
        : defaultTemplate(scene)),
  );
  const productContext = {
    name: brief.name, facts: brief.facts, description: brief.description,
    sellingPoints: brief.sellingPoints, platform: brief.platform, scene,
    designStyle: COMMERCE_TEMPLATES.find(item => item.id === templateId)?.visual.guidance,
  };
  const [instruction, setInstruction] = useState(
    restored?.instruction ?? (prompt || seedPlan?.slots[0]?.instruction || ""),
  );
  const [lastBuiltInstruction, setLastBuiltInstruction] = useState(
    restored?.lastBuiltInstruction ?? restored?.instruction ?? seedPlan?.slots[0]?.instruction ?? "",
  );
  const [preparedSignature, setPreparedSignature] = useState<string>();
  const [seenPrompt, setSeenPrompt] = useState(prompt);
  const [plan, setPlan] = useState<CommercePlan | undefined>(restored?.plan ?? seedPlan);
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
  const creation = useRef(restored?.creation);
  const [recoveringCreate, setRecoveringCreate] = useState(Boolean(restored?.creation));
  const sessionRequest = useRef<string>(restored?.sessionId ?? crypto.randomUUID());
  const draftSnapshot = (): CommerceDraftState => ({ scene, brief, count, templateId, instruction, lastBuiltInstruction, roles,
    settings: generationSettings, plan, sessionId: remoteSession.current, creation: creation.current });
  useEffect(() => {
    if (!active) return;
    try { saveCommerceDraft(storageKey, draftSnapshot()); } catch { /* Remote actions fail closed if recovery cannot be saved. */ }
  });
  const referenceKey = (reference: UploadReference) =>
    reference.file ? `${reference.name}:${reference.size}:${reference.file.lastModified}` : reference.id ?? reference.name;
  const roleOf = (reference: UploadReference) =>
    contentOnly
      ? "style"
      : (roles[referenceKey(reference)] ??
    (reference.id &&
    [
      ...promotedStyleIds,
      ...(seedPlan?.brief.styleReferenceIds ?? []),
    ].includes(reference.id)
      ? "style"
      : "product"));
  const referenceSignature = JSON.stringify(
    references.map((reference) => [referenceKey(reference), roleOf(reference)]),
  );
  // File identity survives upload completion and restored object URLs.
  if (
    active &&
    preparedSignature &&
    preparedSignature !== referenceSignature &&
    step > 1
  ) {
    setStep(1);
    setError("共享参考图或用途已变化，生成时将按最新素材重新准备。");
  }
  const invalidatePreview = () => {
    if (step === 3) {
      setStep(1);
      setError("方案资料已修改，生成时将使用最新资料。");
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
  const preparePlan = async (previewOnly = false): Promise<CommercePlan> => {
      if (!gateway) throw new Error("电商服务暂未连接，请稍后重试。");
      if (creation.current) {
        // A lost create response must replay the original body even after reload.
        return creation.current.plan;
      }
      if (!contentOnly && !references.some(reference => roleOf(reference) === 'product'))
        throw new Error("请上传至少一张清晰的真实商品图。");
      const description = brief.description?.trim() || [brief.name, brief.facts, brief.sellingPoints].filter(Boolean).join('\n');
      const name = brief.name.trim() || description.split(/[\n。！？]/).find(line => line.trim())?.trim().slice(0, 160) || '';
      if (!name) throw new Error(contentOnly ? "请填写海报标题。" : "请填写商品描述，包含商品名称或主要特点。");
      if (scene === 'style-reference' && !references.some(reference => roleOf(reference) === 'style'))
        throw new Error("请添加一张风格参考图。");
      let targetSession = remoteSession.current ?? sessionId;
      if (!previewOnly && isLocalCommerceDraft(targetSession)) {
        if (!ensureSession) throw new Error('暂时无法保存会话，请重试。');
        // Client-selected UUID makes session creation itself safe to replay.
        remoteSession.current = sessionRequest.current;
        saveCommerceDraft(storageKey, draftSnapshot());
        targetSession = await ensureSession(name, sessionRequest.current);
        remoteSession.current = targetSession;
        saveCommerceDraft(storageKey, draftSnapshot());
      } else if (!previewOnly && ensureSession && isLocalCommerceDraft(sessionId)) {
        targetSession = await ensureSession(name, targetSession);
      }
      const productReferenceIds: string[] = [];
      const styleReferenceIds: string[] = [];
      for (const reference of references) {
        if (reference.status !== 'ready') throw new Error('请等待参考图上传完成，或移除失败图片后重试。');
        let id = reference.id ?? uploadIds.current.get(reference);
        if (!id && previewOnly) id = crypto.randomUUID();
        if (!id) {
          const { previewUrl: _preview, ...upload } = reference;
          void _preview;
          id = await gateway.upload(targetSession, upload);
          uploadIds.current.set(reference, id);
          onReferenceUploaded(reference, id, sessionId);
        }
        (roleOf(reference) === 'style' ? styleReferenceIds : productReferenceIds).push(id);
      }
      const complete = { ...brief, name, ...(contentOnly ? {} : { description }), productReferenceIds, styleReferenceIds };
      const question = nextCommerceQuestion(complete, scene);
      if (question) throw new Error(question);
      setBrief(complete);
      setPreparedSignature(referenceSignature);
      const nextPlan = makePlan(complete);
      setSelectedSlotId(current => nextPlan.slots.some(slot => slot.id === current) ? current : nextPlan.slots[0]?.id);
      saveCommerceDraft(storageKey, { ...draftSnapshot(), brief: complete, plan: nextPlan });
      return nextPlan;
  };
  const prepare = () => act(async () => { await preparePlan(true); setStep(3); onPreview?.(); });
  const makePlan = (preparedBrief: CommerceBrief) => {
    const generatedExactText = (source: CommerceBrief, role: string) => {
      if (
        ["商品主图", "使用场景", "生活场景", "模特展示", "风格创作"].includes(
          role,
        )
      )
        return "";
      const points = source.sellingPoints
        .split(/\n|[；;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const detail = ["材质细节", "商品说明", "细节说明"].includes(role) ? source.facts : role === "核心卖点" ? points.slice(0, 3).join("\n") : points[0];
      return [source.name, detail].filter(Boolean).join("\n");
    };
    const slots = buildCommerceSlots(
      preparedBrief,
      scene,
      count,
      isPoster
        ? { ...generationSettings, aspectRatio: "3:4", resolution: "2K" }
        : generationSettings,
    ).map((slot, index) => {
      const previous = plan?.slots[index];
      const previousGeneratedText = previous
        ? isPoster
          ? buildCommerceSlots(
              plan!.brief,
              scene,
              plan!.slots.length,
              settings,
            )[index]?.exactText
          : generatedExactText(plan!.brief, previous.role)
        : undefined;
      return {
          ...slot,
          ...previous,
          textMode: previous?.textMode ?? (preparedBrief.description && !isPoster ? slot.role === '商品主图' ? 'none' as const : 'auto' as const : undefined),
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
    });
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
    const billing = generate
      ? credits.confirm(
          nextPlan.slots.map((slot) => imageCreditItem({ ...slot, count: 1 })),
        )
      : undefined;
    const key = JSON.stringify(nextPlan);
    if (createRequest.current?.key !== key)
      createRequest.current = { key, requestId: crypto.randomUUID() };
    setRecoveringCreate(true);
    creation.current ??= { requestId: createRequest.current.requestId, plan: nextPlan };
    saveCommerceDraft(storageKey, { ...draftSnapshot(), creation: creation.current });
    let task = await gateway.create({ sessionId: remoteSession.current ?? sessionId, ...creation.current });
    if (generate) {
      try {
        task = await submitCommerceOnce(gateway, task, billing);
        notifyCreditsChanged();
      } catch (cause) {
        // The task card owns recovery of this exact persisted submit request.
        clearCommerceDraft(storageKey);
        onSaved(task, false);
        throw cause;
      }
    }
    clearCommerceDraft(storageKey);
    onSaved(task, false);
  };
  const save = (generate = false) => act(async () => {
    const nextPlan = await preparePlan();
    await savePlan(nextPlan, generate);
  });
  const feeSlots = Array.from({ length: count }, (_, index) => plan?.slots[index] ?? generationSettings);
  return (
    <section
      aria-label={`${definition.name}向导`}
      className={`${styles.wizard} ${styles.wizardWorkbench} ${embedded ? styles.wizardEmbedded : ""}`}
    >
      {!embedded && <div className={styles.heading}>
        <h2>{definition.name}</h2>
        <button onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? "展开资料" : "收起资料"}
        </button>
      </div>}
      {!collapsed && (
        <div className={styles.wizardColumns}>
          <div className={styles.wizardSettings}>
            <div className={styles.wizardFormScroll}>
              <fieldset disabled={busy || recoveringCreate} className={styles.formBody}>
                  {isPoster && (
                    <label>内容类型<CommerceSelect aria-label="海报内容类型" value={brief.contentMode ?? "product"} onChange={(value) => patch({ contentMode: value as "product" | "content" })}><option value="content">通用内容</option><option value="product">商品种草</option></CommerceSelect></label>
                  )}
                  <p>{contentOnly ? "填写标题与正文，选择风格制作海报。多张内容请按段落分行。" : "上传商品图，描述商品特点，即可一键生成。"}</p>
                  <label>
                    {contentOnly ? "风格参考图（选填）" : "商品图片"}
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
                  {scene === 'style-reference' && <label>风格参考图
                    <input aria-label="上传风格参考图" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => {
                      if (event.target.files) {
                        const additions = Object.fromEntries(Array.from(event.target.files).map(file => [`${file.name}:${file.size}:${file.lastModified}`, 'style' as const]));
                        setRoles(current => ({ ...current, ...additions }));
                        onReferenceAdd(event.target.files);
                      }
                      event.target.value = '';
                    }} />
                  </label>}
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
                        <details className={styles.referenceRole}><summary>{roleOf(reference) === "product" ? "商品图" : "风格图"}</summary><label>
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
                        </label></details>
                        <button onClick={() => onReferenceRemove(index)}>
                          移除参考图 {index + 1}
                        </button>
                      </div>
                    ))}
                  </div>
                  {!contentOnly && <CreativeTextField productContext={productContext} field="description" label="商品描述" multiline rows={4} maxLength={4000}
                    placeholder="例如：米白色女士衬衫，棉质面料，宽松版型，适合日常通勤。可补充已确认的规格和卖点。"
                    value={brief.description ?? [brief.name, brief.facts, brief.sellingPoints].filter(Boolean).join('\n')}
                    onChange={description => patch({ description })} />}
                  <details className={styles.advancedOptions} open={contentOnly || undefined}>
                    <summary>高级设置 · 平台、风格、数量与分图</summary>
                  <label>文字优化模型<CommerceSelect aria-label="文字优化模型" disabled={busy || recoveringCreate}
                    value={selectedChatModel === 'minimax' ? 'minimax' : 'doubao'} onChange={setSelectedChatModel}>
                    <option value="doubao">豆包</option><option value="minimax">MiniMax</option>
                  </CommerceSelect></label>
                  <CreativeTextField productContext={productContext} field={contentOnly ? "title" : "name"} label={contentOnly ? "海报标题" : "商品名称"} maxLength={160} value={brief.name} onChange={(name) => patch({ name })} />
                  <div className={styles.twoColumns}>
                    <label>
                      平台
                      <CommerceSelect
                        disabled={busy || recoveringCreate || isPoster}
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
                        disabled={busy || recoveringCreate}
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
                  {contentOnly ? (
                    <CreativeTextField productContext={productContext} field="content" label="海报内容" maxLength={4000} multiline rows={6} value={brief.facts} onChange={(facts) => patch({ facts })} context={brief.name} placeholder="填写要呈现的内容，多张卡片请按段落分行" />
                  ) : (
                    <>
                      <details className={styles.advancedOptions}>
                    <summary>商品事实（选填）</summary>
                    <CreativeTextField productContext={productContext} field="facts" label="商品事实" maxLength={4000} multiline value={brief.facts} onChange={(facts) => patch({ facts })} context={brief.name} placeholder="仅填写已确认的外观、材质与规格" />
                  </details>
                      <CreativeTextField productContext={productContext}
                        field="sellingPoints" label="商品卖点" maxLength={2000} multiline value={brief.sellingPoints} onChange={(sellingPoints) => patch({ sellingPoints })} context={`${brief.name}\n${brief.facts}`}
                      />
                    </>
                  )}
                  <label>
                    风格方向
                    <CommerceSelect
                      disabled={busy || recoveringCreate}
                      aria-label="风格模板"
                      value={templateId}
                      onChange={(value) => {
                        invalidatePreview();
                        setTemplateId(value);
                      }}
                    >
                      {!templatesForScene(scene).some(
                        (item) => item.id === templateId,
                      ) && (
                        <option value={templateId}>
                          历史模板 ·{" "}
                          {COMMERCE_TEMPLATES.find(
                            (item) => item.id === templateId,
                          )?.name ?? templateId}
                        </option>
                      )}
                      {templatesForScene(scene).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
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
                      disabled={busy || recoveringCreate}
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
                    <CreativeTextField productContext={productContext}
                      field="instruction"
                      label="整套创作要求"
                      multiline
                      maxLength={2000}
                      value={instruction}
                      context={`${brief.name}\n${brief.facts}`}
                      onChange={(value) => {
                        invalidatePreview();
                        setInstruction(value);
                      }}
                    />
                  </details>
                  <p>
                    建议角色：{definition.roles.join("、")}
                    ；也可展开逐图设置调整。
                  </p>
                    <label>生成模型<CommerceSelect disabled={busy || recoveringCreate} aria-label="电商生成模型" value={`${generationSettings.provider}::${generationSettings.model}`} onChange={value => {
                      const [provider, model] = value.split('::');
                      const capability = capabilities.find(item => item.provider === provider)?.models.find(item => item.id === model);
                      if (provider && model && capability) { invalidatePreview(); const nextSettings = { provider, model,
                        aspectRatio: capability.aspectRatios.includes(generationSettings.aspectRatio) ? generationSettings.aspectRatio : capability.aspectRatios[0]!,
                        resolution: capability.resolutions.includes(generationSettings.resolution) ? generationSettings.resolution : capability.resolutions[0]! }; setGenerationSettings(nextSettings); setPlan(current => current && ({ ...current, slots: current.slots.map(slot => ({ ...slot, ...nextSettings })) })); }
                    }}>{capabilities.flatMap(provider => provider.models.map(model => <option key={`${provider.provider}::${model.id}`} value={`${provider.provider}::${model.id}`}>{model.label}</option>))}</CommerceSelect></label>
                  </details>
              </fieldset>
            </div>
            {error && <p role="alert">{error}</p>}
            {recoveringCreate && !busy && <p className={styles.note}>已保留本次方案，点击生成或保存将恢复同一任务。</p>}
            <div className={`${styles.actions} ${styles.wizardControls}`}>
              <div className={styles.generationSummary}><p className={styles.note}>
                本次生成 {step === 3 ? plan?.slots.length : count}{" "}
                张
              </p>
              <CreditFee items={feeSlots.map(slot => imageCreditItem({ ...slot, count: 1 }))} /></div>
              <button className={styles.primary} disabled={busy || !active} onClick={() => void save(true)}>{busy ? '正在准备…' : `一键生成 ${step === 3 ? plan?.slots.length ?? count : count} 张`}</button>
              <button disabled={busy || !active} onClick={() => void prepare()}>调整分图方案</button>
              <button disabled={busy || !active} onClick={() => void save()}>保存草稿</button>
              <button disabled={busy} onClick={() => { clearCommerceDraft(storageKey); onClose(); }}>
                取消方案
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
              <fieldset disabled={busy || recoveringCreate} className={styles.formBody}>
                <CommercePlanFields
                  disabled={busy || recoveringCreate}
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
                  填写左侧商品资料后，可点击“调整分图方案”查看和编辑每张图，也可以直接一键生成。
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
                      <TemplatePreview
                        templateId={templateId}
                        role={
                          isPoster
                            ? index === 0
                              ? "海报封面"
                              : "内容卡片"
                            : definition.roles[index % definition.roles.length]
                        }
                      />
                      <strong>
                        {isPoster
                          ? index === 0
                            ? "海报封面"
                            : "内容卡片"
                          : definition.roles[index % definition.roles.length]}
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
