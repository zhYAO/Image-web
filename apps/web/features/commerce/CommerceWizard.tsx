import {CommercePackagePanel}from'./CommercePackagePanel';
import {defaultPackageClient,type PackageRecovery}from'@/gateways/commerce-package-gateway';
import {packageOrderViewSchema,formatCredits,type PackageOrderView}from'@zimage/domain';
import { CommerceAnalysisPanel } from './CommerceAnalysisPanel';
import { PreviewImage } from '@/features/controls/PreviewImage';
import { useCredits, CreditFee } from "@/features/credits/CreditsProvider";
import { imageCreditItem, IMAGE_MODEL_UPGRADE_MESSAGE } from "@zimage/domain";
import { CommerceEditor } from "./CommerceEditor";
import { commerceGenerationPreset, hasCommerceModel, commerceProviderCapabilities } from "./commerce-presets";
import { CommerceSelect } from "./CommerceSelect";
import {
  buildCommerceSlots,
  assertAnalysisReviewCurrent,
  COMMERCE_PLATFORMS,
  COMMERCE_SCENES,
  COMMERCE_TEMPLATES,
  COMMERCE_REGIONS,
  COMMERCE_LANGUAGES,
  PLATFORM_PRESETS,
  DETAIL_MODULES,
  APLUS_SPECS,
  SELLING_LAYOUTS,
  aPlusAspectRatio,
  maxCommerceSlots,
  creativeListingCopySchema,
  parseCreativeStrategy,
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

import { Layers3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CommercePlanFields } from "./CommercePlanFields";
import { defaultTemplate } from "./commerce-ui";
import styles from "./commerce.module.css";
import { TemplatePreview } from "./TemplatePreview";
import { loadCommerceDraft, saveCommerceDraft, clearCommerceDraft, type CommerceDraftState } from "./commerce-draft-storage";
import { submitCommerceOnce } from "./commerce-submission";
import { isLocalCommerceDraft } from "@/features/workspace/workspace-route";
import { notifyCreditsChanged } from "@/gateways/mock-credit-ledger";
import { requestCreativeTextOptimization } from '@/gateways/creative-text-gateway';
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
  referencesPreparing?: boolean;
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
  referencesPreparing = false,
  capabilities:providedCapabilities,
  settings,
  onReferenceAdd,
  onReferenceRemove,
  onReferenceUploaded,
  onSaved,
  onClose,
}: CommerceWizardProps) {
  const capabilities=useMemo(()=>commerceProviderCapabilities(providedCapabilities),[providedCapabilities]);
  const definition = COMMERCE_SCENES.find((item) => item.id === scene)!;
  const isPoster = scene === "xhs-poster";
  const credits = useCredits();
  const simplified = ["product-set", "detail", "clone", "product-main"].includes(scene);
  const setSelectedChatModel = useWorkspaceStore(state => state.setSelectedChatModel);
  const storageKey = draftKey ?? sessionId;
  const [restored] = useState(() => loadCommerceDraft(storageKey));
  const [packagesAvailable,setPackagesAvailable]=useState(false);
  const packageFlow=scene==='detail'&&(packagesAvailable||Boolean(restored?.packageRecovery));
  useEffect(()=>{if(scene!=='detail')return;let live=true;void defaultPackageClient.available().then(value=>{if(live)setPackagesAvailable(value);});return()=>{live=false;};},[scene]);
  const remoteSession = useRef(restored?.sessionId);
  const [generationSettings, setGenerationSettings] = useState(() => {
    const previous = restored?.plan?.slots[0] ?? seedPlan?.slots[0];
    const prior = restored?.settings ?? (previous ? { provider: previous.provider, model: previous.model, aspectRatio: previous.aspectRatio, resolution: previous.resolution } : undefined);
    return prior ?? (simplified || !hasCommerceModel(capabilities,settings) ? commerceGenerationPreset(capabilities) : settings);
  });
  const defaultsReady = useRef(Boolean(restored || seedPlan) || capabilities.length > 0);
  useEffect(() => {
    if (!simplified || defaultsReady.current || !capabilities.length) return;
    defaultsReady.current = true;
    setGenerationSettings(commerceGenerationPreset(capabilities));
  }, [capabilities, simplified]);
  const [step, setStep] = useState(1);
  const [brief, setBrief] = useState<CommerceBrief>(
    restored?.brief ?? seedPlan?.brief ?? {
      name: "",
      facts: "",
      sellingPoints: "",
      platform: isPoster ? "xiaohongshu" : platform,
      region: "cn", language: "zh-CN",
      contentMode: isPoster ? "content" : "product",
      cloneMode: scene === 'clone' ? 'style' : undefined,
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
  const [categoryCounts, setCategoryCounts] = useState(() => {
    if (restored?.categoryCounts) return restored.categoryCounts;
    const previous = restored?.plan ?? seedPlan;
    const previousCount = previous?.slots.length ?? restored?.count;
    if (scene !== 'product-set' || previousCount === undefined) return { white: 1, selling: 3, scene: 2, other: 1 };
    if (previous?.slots.every(slot => slot.category)) return {
      white: previous.slots.filter(slot => slot.category === 'white').length,
      selling: previous.slots.filter(slot => slot.category === 'selling').length,
      scene: previous.slots.filter(slot => slot.category === 'scene').length,
      other: previous.slots.filter(slot => slot.category === 'other').length,
    };
    const white = Math.min(1, previousCount);
    const selling = Math.min(2, previousCount - white);
    const sceneCount = Math.min(2, previousCount - white - selling);
    return { white, selling, scene: sceneCount, other: Math.max(0, previousCount - white - selling - sceneCount) };
  });
  const [detailModules, setDetailModules] = useState<string[]>(() => {
    if (restored?.detailModules) return restored.detailModules;
    if (seedPlan?.scene !== 'detail') return [...DETAIL_MODULES.slice(0, 6)];
    const existing = seedPlan.slots.map(slot => slot.module ?? slot.role).filter((module, index, all) => DETAIL_MODULES.includes(module as typeof DETAIL_MODULES[number]) && all.indexOf(module) === index);
    return existing.length ? existing : [...DETAIL_MODULES.slice(0, Math.min(16, seedPlan.slots.length))];
  });
  const [referenceInstructions, setReferenceInstructions] = useState<Record<string, string>>(restored?.referenceInstructions ?? {});
  const [referenceSource, setReferenceSource] = useState<'files' | 'url'>(restored?.referenceSource ?? 'files');
  const [sceneTab, setSceneTab] = useState<'templates' | 'custom' | 'reference'>(restored?.sceneTab ?? 'templates');
  const [editorStage, setEditorStage] = useState<'configure' | 'review'>(restored?.editorStage ?? 'configure');
  const [sellingLayouts, setSellingLayouts] = useState<typeof SELLING_LAYOUTS[number][]>(restored?.sellingLayouts ?? seedPlan?.slots.filter(slot => slot.category === 'selling').map(slot => slot.layout ?? '自动分配') ?? []);
  const [advancedAplus, setAdvancedAplus] = useState(restored?.advancedAplus ?? Boolean(seedPlan?.slots.some(slot => slot.outputSpec === 'desktop' || slot.outputSpec === 'mobile')));
  const [touchedPresets, setTouchedPresets] = useState(restored?.touchedPresets ?? { region: false, language: false, aspectRatio: false });
  const [templateId, setTemplateId] = useState(
    restored?.templateId ?? seedPlan?.templateId ??
      (templatesForScene(scene).some((item) => item.id === initialTemplateId)
        ? initialTemplateId!
        : defaultTemplate(scene)),
  );
  const productContext = {
    name: brief.name, facts: brief.facts, description: brief.description,
    sellingPoints: brief.sellingPoints, platform: brief.platform, scene,
    region: brief.region ?? PLATFORM_PRESETS[brief.platform]?.region, language: brief.language ?? PLATFORM_PRESETS[brief.platform]?.language,
    designStyle: [brief.analysisReview?.styleSummary, brief.visualStrategy, COMMERCE_TEMPLATES.find(item => item.id === templateId)?.visual.guidance].filter(Boolean).join('\n').slice(0,2000),
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
  const [operationBusy, setBusy] = useState(false);
  const busy = operationBusy || referencesPreparing;
  const [collapsed, setCollapsed] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState(seedPlan?.slots[0]?.id);
  const showPlan = step === 3 && plan && previewPanel !== "examples";
  if (seenPrompt !== prompt) {
    setSeenPrompt(prompt);
    setInstruction((current) => [current, prompt].filter(Boolean).join("\n"));
    if (step === 3) setStep(1);
  }

  const uploadIds = useRef(new Map<string, string>());
  const createRequest = useRef<{ key: string; requestId: string } | undefined>(
    undefined,
  );
  const [packageOrder,setPackageOrder]=useState<PackageOrderView>();
  const packageOrderRef=useRef<PackageOrderView|undefined>(undefined);
  const [packageRecovery,setPackageRecovery]=useState<PackageRecovery|undefined>(restored?.packageRecovery);
  const packageRecoveryRef=useRef(packageRecovery);
  const locked = useRef(false);
  const creation = useRef(restored?.creation);
  const [recoveringCreate, setRecoveringCreate] = useState(Boolean(restored?.creation));
  const sessionRequest = useRef<string>(restored?.sessionId ?? crypto.randomUUID());
  const draftSnapshot = (): CommerceDraftState => ({ scene, editorStage, sellingLayouts, referenceInstructions, referenceSource, sceneTab, brief, count, categoryCounts, detailModules, advancedAplus, touchedPresets, templateId, instruction, lastBuiltInstruction, roles,
    settings: generationSettings, plan, sessionId: remoteSession.current, creation: creation.current,packageRecovery:packageRecoveryRef.current });
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
  const packageKey=(modules=detailModules,advanced=advancedAplus,model=generationSettings.model,platform=brief.platform,region=brief.region,language=brief.language)=>JSON.stringify({references:referenceSignature,modules,advanced,model,platform,region:region??'',language:language??''});
  const packageFingerprint=packageKey();
  const latestPackageFingerprint=useRef(packageFingerprint);useEffect(()=>{latestPackageFingerprint.current=packageFingerprint;},[packageFingerprint]);
  const writePackageRecovery=(value:PackageRecovery)=>{packageRecoveryRef.current=value;saveCommerceDraft(storageKey,{...draftSnapshot(),packageRecovery:value});setPackageRecovery(value);};
  const receivePackageOrder=(value:PackageOrderView|undefined)=>{
    const previous=packageOrderRef.current;
    if(value&&previous?.id===value.id&&previous.revision>value.revision)return;
    packageOrderRef.current=value;setPackageOrder(value);
    if(value?.review)setBrief(current=>current.analysisReview?current:{...current,name:value.review!.name,facts:value.review!.facts,visualStrategy:value.review!.styleSummary,analysisReview:{referenceSignature,facts:value.review!.facts,styleSummary:value.review!.styleSummary}});
  };
  const assertPackageCurrent=()=>{
    const order=packageOrderRef.current,r=packageRecoveryRef.current;
    if(!order||!r)throw Error('请先确认整套预算。');
    if((r.resumeFingerprint??r.fingerprint)!==latestPackageFingerprint.current)throw Error('图片或设置已变化，请恢复原订单，或取消后重新报价。');
    if(!order.review||order.review.facts!==brief.facts||order.review.name!==brief.name)throw Error('请先核对并确认原订单商品资料。');
    if(order.billingReviewReason)throw Error('供应商用量待核对，暂不继续付费操作。');
    return order;
  };
  const resumePackage=(order:PackageOrderView)=>{
    const r=packageRecoveryRef.current;if(!r)return;
    const review=order.review;
    const platformValue=(review?.platform??brief.platform)as CommerceBrief['platform'];
    const regionValue=(review?.region??brief.region)as CommerceBrief['region'];
    const languageValue=(review?.language??brief.language)as CommerceBrief['language'];
    setDetailModules(order.quote.selection.modules);setAdvancedAplus(order.quote.selection.advanced);
    setGenerationSettings(current=>({...current,provider:'seedream',model:order.quote.imageModel,resolution:'2K'}));
    remoteSession.current=order.sessionId;
    setBrief(current=>({...current,...(review?{name:review.name,facts:review.facts,visualStrategy:review.styleSummary,analysisReview:{referenceSignature,facts:review.facts,styleSummary:review.styleSummary}}:{}),platform:platformValue,region:regionValue,language:languageValue,productReferenceIds:order.references.filter(r=>r.role==='product').map(r=>r.id),styleReferenceIds:order.references.filter(r=>r.role==='style').map(r=>r.id)}));
    writePackageRecovery({...r,resumeFingerprint:packageKey(order.quote.selection.modules,order.quote.selection.advanced,order.quote.imageModel,platformValue,regionValue,languageValue)});
  };
  const preparePackageInput=async()=>{
    if(!gateway)throw Error('商品图片服务暂不可用。');
    if(references.length<1||references.length>10||!references.some(r=>roleOf(r)==='product'))throw Error('请上传1–10张图片，至少包含一张商品实拍图。');
    const signature=packageFingerprint;
    let target=remoteSession.current??sessionId;
    if(isLocalCommerceDraft(target)){
      if(!ensureSession)throw Error('会话服务暂时不可用，请保留原草稿。');
      remoteSession.current=sessionRequest.current;saveCommerceDraft(storageKey,draftSnapshot());
      target=await ensureSession(brief.name.trim()||'商品图片分析',sessionRequest.current);remoteSession.current=target;
    }
    const frozen:Array<{id:string;role:'product'|'style'}>=[];
    for(const reference of references){
      if(reference.status!=='ready')throw Error('请等待所有图片上传完成。');
      const key=referenceKey(reference);
      const stale=isLocalCommerceDraft(sessionId)&&reference.file&&reference.id&&![...brief.productReferenceIds,...brief.styleReferenceIds].includes(reference.id);
      let id=uploadIds.current.get(key)??(stale?undefined:reference.id);
      if(!id){const{previewUrl:_preview,id:_id,...upload}=reference;void _preview;void _id;id=await gateway.upload(target,upload);uploadIds.current.set(key,id);onReferenceUploaded(reference,id,sessionId);}
      frozen.push({id,role:roleOf(reference)});
    }
    if(latestPackageFingerprint.current!==signature)throw Error('准备报价时图片或设置已变化，请重新核对。');
    const complete={...brief,productReferenceIds:frozen.filter(r=>r.role==='product').map(r=>r.id),styleReferenceIds:frozen.filter(r=>r.role==='style').map(r=>r.id)};
    setBrief(complete);setPreparedSignature(referenceSignature);saveCommerceDraft(storageKey,{...draftSnapshot(),brief:complete});
    return{sessionId:target,imageModel:generationSettings.model,selection:{modules:detailModules,advanced:advancedAplus,referenceCount:frozen.length},references:frozen};
  };
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
  const unavailableModel = capabilities.length > 0 && (!hasCommerceModel(capabilities, generationSettings) || Boolean(plan?.slots.some(slot => !hasCommerceModel(capabilities, slot))));
  const resetModel = () => {
    if (creation.current) return;
    const preset = commerceGenerationPreset(capabilities);
    setGenerationSettings(preset);
    setPlan(current => current ? { ...current, slots: current.slots.map(slot => ({ ...slot, ...preset, ...(slot.outputSpec ? { aspectRatio: aPlusAspectRatio(slot.outputSpec) } : {}) })) } : current);
    setError(undefined);
    setStep(1);
  };
  const preparePlan = async (previewOnly = false): Promise<CommercePlan> => {
      if (!gateway) throw new Error("电商服务暂未连接，请稍后重试。");
      if (creation.current) {
        // A lost create response must replay the original body even after reload.
        return creation.current.plan;
      }
      assertAnalysisReviewCurrent(brief.analysisReview,referenceSignature,brief.facts);
      if (unavailableModel) throw new Error(IMAGE_MODEL_UPGRADE_MESSAGE);
      if (!(packageFlow&&packageRecoveryRef.current?.resumeFingerprint) && !contentOnly && scene !== 'clone' && !references.some(reference => roleOf(reference) === 'product'))
        throw new Error("请上传至少一张清晰的真实商品图。");
      const description = brief.description?.trim() || [brief.name, brief.facts, brief.sellingPoints].filter(Boolean).join('\n');
      const name = brief.name.trim() || description.split(/[\n。！？]/).find(line => line.trim())?.trim().slice(0, 160) || (scene === 'clone' ? '参考图复刻' : '');
      if (!name) throw new Error(contentOnly ? "请填写海报标题。" : "请填写商品描述，包含商品名称或主要特点。");
      if ((scene === 'style-reference' || scene === 'clone') && !references.some(reference => roleOf(reference) === 'style'))
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
      const frozenPackage=packageFlow&&packageRecoveryRef.current?.resumeFingerprint?assertPackageCurrent():undefined;
      for (const reference of frozenPackage?[]:references) {
        if (reference.status !== 'ready') throw new Error('请等待参考图上传完成，或移除失败图片后重试。');
        const referenceIdentity = referenceKey(reference);
        // A fresh local draft can retain File bytes from a just-saved session.
        // Only IDs already bound to this draft's brief may cross a reload.
        const staleLocalId = isLocalCommerceDraft(sessionId) && reference.file && reference.id
          && ![...brief.productReferenceIds, ...brief.styleReferenceIds].includes(reference.id);
        let id = uploadIds.current.get(referenceIdentity) ?? (staleLocalId ? undefined : reference.id);
        if (!id && previewOnly) id = crypto.randomUUID();
        if (!id) {
          const { previewUrl: _preview, id: _previousId, ...upload } = reference;
          void _preview;
          void _previousId;
          id = await gateway.upload(targetSession, upload);
          uploadIds.current.set(referenceIdentity, id);
          onReferenceUploaded(reference, id, sessionId);
        }
        (roleOf(reference) === 'style' ? styleReferenceIds : productReferenceIds).push(id);
      }
      if(frozenPackage)for(const r of frozenPackage.references)(r.role==='style'?styleReferenceIds:productReferenceIds).push(r.id);
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
  const importReferenceUrl = () => act(async () => {
    if (references.filter(ref => roleOf(ref) === 'style').length >= 20) throw new Error('最多添加 20 张复刻参考图。');
    if (!brief.sourceUrl?.trim()) throw new Error('请先填写公开商品链接。');
    const response = await fetch('/api/commerce/import-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: brief.sourceUrl }) });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(`${result?.message || '链接导入失败'} 请保留链接并手动上传参考图。`);
    }
    const blob = await response.blob();
    const file = new File([blob], `imported-reference.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type });
    const transfer = new DataTransfer(); transfer.items.add(file);
    setRoles(current => ({ ...current, [`${file.name}:${file.size}:${file.lastModified}`]: 'style' }));
    onReferenceAdd(transfer.files);
  });
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
    const targetCount = scene === 'product-set' ? Object.values(categoryCounts).reduce((sum, value) => sum + value, 0) : scene === 'detail' ? detailModules.length * (advancedAplus ? 2 : 1) : scene === 'clone' ? preparedBrief.styleReferenceIds.length : count;
    const slotCategories = (['white', 'selling', 'scene', 'other'] as const).flatMap(category => Array.from({ length: categoryCounts[category] }, () => category));
    const slots = buildCommerceSlots(
      preparedBrief,
      scene,
      targetCount,
      isPoster
        ? { ...generationSettings, aspectRatio: "3:4", resolution: "2K" }
        : generationSettings,
    ).map((slot, index) => {

      const category = scene === 'product-set' ? slotCategories[index] : undefined;
      const detailModule = scene === 'detail' ? detailModules[index % detailModules.length] : undefined;
      const outputSpec: CommerceSlot['outputSpec'] = scene === 'detail' ? (advancedAplus ? (index < detailModules.length ? 'desktop' : 'mobile') : 'standard') : undefined;
      const previous = scene === 'detail' ? plan?.slots.find(item => (item.module ?? item.role) === detailModule && (item.outputSpec ?? 'standard') === outputSpec) : scene === 'clone' ? plan?.slots.find(item => item.referenceIds.includes(preparedBrief.styleReferenceIds[index]!)) : plan?.slots[index];
      const target = outputSpec ? APLUS_SPECS[outputSpec] : undefined;
      const categoryRole = (value: CommerceSlot['category']) => value === 'white' ? '白底商品图' : value === 'selling' ? '核心卖点' : value === 'scene' ? '使用场景' : undefined;
      const oldDefaultRole = categoryRole(previous?.category) ?? definition.roles[index % definition.roles.length];
      const nextDefaultRole = categoryRole(category) ?? slot.role;
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
      const moduleMode = detailModule ? preparedBrief.moduleTextModes?.[detailModule] : undefined;
      if (preparedBrief.language !== 'none' && moduleMode === 'exact' && !preparedBrief.moduleCopy?.[detailModule!]?.trim())
        throw new Error(`请填写「${detailModule}」的指定文案，或选择自动文案、不显示文字。`);
      return {
          ...slot,
          ...previous,
          role: scene === 'clone' ? `参考图 ${index + 1}` : detailModule || (category ? previous && previous.role !== oldDefaultRole ? previous.role : nextDefaultRole : scene === 'product-main' && templateId !== 'white-main' ? COMMERCE_TEMPLATES.find(item => item.id === templateId)?.visual.previewRole ?? slot.role : previous?.role ?? slot.role),
          category, module: detailModule as CommerceSlot['module'], outputSpec,
          aspectRatio: outputSpec ? aPlusAspectRatio(outputSpec) : previous?.aspectRatio ?? slot.aspectRatio,
          targetWidth: target?.width, targetHeight: target?.height,
          layout: category === 'selling' ? (sellingLayouts[index - categoryCounts.white] ?? previous?.layout ?? '自动分配') as typeof SELLING_LAYOUTS[number] : undefined,
          textMode: preparedBrief.language === 'none' || category === 'white' ? 'none' as const : moduleMode ?? (detailModule && preparedBrief.moduleCopy?.[detailModule] !== undefined ? (preparedBrief.moduleCopy[detailModule] ? 'exact' as const : 'none' as const) : previous?.textMode ?? (preparedBrief.description && !isPoster ? slot.role === '商品主图' ? 'none' as const : 'auto' as const : undefined)),
          exactText:
            moduleMode === 'none' ? '' : moduleMode === 'auto' ? generatedExactText(preparedBrief, detailModule!) : moduleMode === 'exact' ? preparedBrief.moduleCopy![detailModule!]!
            : detailModule && preparedBrief.moduleCopy?.[detailModule] !== plan?.brief.moduleCopy?.[detailModule]
              ? preparedBrief.moduleCopy?.[detailModule] ?? ''
              : previous && previous.exactText !== previousGeneratedText
              ? previous.exactText
              : detailModule && preparedBrief.moduleCopy?.[detailModule] ? preparedBrief.moduleCopy[detailModule]! : isPoster ? slot.exactText : generatedExactText(preparedBrief, previous?.role ?? slot.role),
          instruction:
            scene === 'clone' && referenceInstructions[referenceKey(references.filter(ref => roleOf(ref) === 'style')[index]!)] !== undefined
              ? [instruction, referenceInstructions[referenceKey(references.filter(ref => roleOf(ref) === 'style')[index]!)]].filter(Boolean).join('\n').slice(0, 2000)
              : previous && previous.instruction !== lastBuiltInstruction
              ? previous.instruction
              : instruction,
          referenceIds: scene === 'clone' ? [...preparedBrief.productReferenceIds, preparedBrief.styleReferenceIds[index]!]
            : [...preparedBrief.productReferenceIds, ...preparedBrief.styleReferenceIds].slice(0, 14),
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
    if (!creation.current) validateCommercePlan(
      nextPlan.brief,
      nextPlan.scene,
      nextPlan.slots,
      nextPlan.templateId,
    );
    if(packageFlow&&packageOrderRef.current){
      const order=packageOrderRef.current;
      if(order.taskId){const task=await gateway.get(order.taskId);clearCommerceDraft(storageKey);onSaved(task,false);return;}
      if(!generate)throw Error('整套订单已保存，请在这里继续，或取消原订单后另存草稿。');
      assertPackageCurrent();
      if(!order.planning)throw Error('请先生成并检查原订单的策划。');
      const key=JSON.stringify(nextPlan);
      if(createRequest.current?.key!==key)createRequest.current={key,requestId:crypto.randomUUID()};
      creation.current??={requestId:createRequest.current.requestId,plan:nextPlan};setRecoveringCreate(true);
      saveCommerceDraft(storageKey,{...draftSnapshot(),creation:creation.current});
      const task=await gateway.create({sessionId:order.sessionId,...creation.current});
      const updated=packageOrderViewSchema.parse(await defaultPackageClient.post({action:'submit',orderId:order.id,references:order.references,taskId:task.id,revision:task.revision}));receivePackageOrder(updated);notifyCreditsChanged();
      const committed=await gateway.get(task.id);clearCommerceDraft(storageKey);onSaved(committed,false);return;
    }
    if(packageFlow&&generate)throw Error('请先确认整套预算及商品资料。');
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
  const textBilling = () => credits.confirm([{ operation: 'optimize', provider: 'doubao', model: 'doubao', resolution: '', count: 1 }]);
  const analyzeImages = async () => {
    if (!gateway) throw new Error('电商服务暂未连接。');
    if (!references.some(ref => roleOf(ref) === 'product')) throw new Error('请先上传真实商品图。');
    if (references.length > 10) throw new Error('请将分析图片减少到 10 张以内。');
    // Pricing is not approved: fail before creating sessions or uploading files.
    const response = await fetch('/api/commerce-analysis', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID()})});
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || '图片分析暂不可用。');
    throw new Error('图片分析服务尚未开放。');
  };
  const generateStrategy = () => act(async () => {
    assertAnalysisReviewCurrent(brief.analysisReview,referenceSignature,brief.facts);
    if (!brief.name.trim() && !brief.description?.trim()) throw new Error('请先填写商品资料。');
    const output=packageFlow?await(async()=>{
      const order=assertPackageCurrent();const fingerprint=latestPackageFingerprint.current;
      const updated=packageOrderViewSchema.parse(await defaultPackageClient.post({action:'plan',orderId:order.id,references:order.references}));receivePackageOrder(updated);notifyCreditsChanged();
      if(latestPackageFingerprint.current!==fingerprint)throw Error('策划已保存在原订单，当前资料已变化，请恢复原设置。');
      if(!updated.planning)throw Error('原订单策划待核对，请勿重复购买。');return updated.planning;
    })():await(async()=>{
    const response = await requestCreativeTextOptimization({ field: 'strategy', text: `为这些模块制定视觉策略与简短文案。\n模块：${detailModules.join('、')}`, expectedModules: detailModules, productContext, chatModel: 'doubao', requestId: crypto.randomUUID(), billing: textBilling(), maxLength: 4000 });
    notifyCreditsChanged();
    return parseCreativeStrategy(JSON.parse(response.text), detailModules);
    })();
    const moduleCopy = { ...brief.moduleCopy };
    const moduleTextModes = { ...brief.moduleTextModes };
    for (const item of output.modules) {
      moduleCopy[item.name] = item.copy;
      // Preserve an explicit choice; older drafts keep their existing copy semantics.
      if (moduleTextModes[item.name] === undefined) moduleTextModes[item.name] = item.copy.trim() ? 'exact' : 'none';
    }
    patch({ visualStrategy: output.strategy, moduleCopy, moduleTextModes });
  });
  const generateListingCopy = () => act(async () => {
    if(packageFlow&&packageOrderRef.current)throw Error('整套预算已包含 A+ 策划，请先完成或取消原订单，再单独生成其他文案。');
    assertAnalysisReviewCurrent(brief.analysisReview,referenceSignature,brief.facts);
    if (!brief.name.trim() && !brief.description?.trim()) throw new Error('请先填写商品资料。');
    const response = await requestCreativeTextOptimization({ field: 'listingCopy', text: '依据 productContext 中已确认的商品资料生成上架文案。', productContext, chatModel: 'doubao', requestId: crypto.randomUUID(), billing: textBilling(), maxLength: 6000 });
    notifyCreditsChanged();
    patch({ listingCopy: creativeListingCopySchema.parse(JSON.parse(response.text)) });
  });
  const plannedCount = scene === 'product-set' ? Object.values(categoryCounts).reduce((sum, value) => sum + value, 0) : scene === 'detail' ? detailModules.length * (advancedAplus ? 2 : 1) : scene === 'clone' ? references.filter(reference => roleOf(reference) === 'style').length : count;
  const feeSlots = Array.from({ length: plannedCount }, (_, index) => plan?.slots[index] ?? generationSettings);
  if (['product-set', 'detail', 'clone', 'product-main'].includes(scene)) return <CommerceEditor
    packageFlow={packageFlow}
    analysisPanel={packageFlow?<CommercePackagePanel fingerprint={packageFingerprint} recovery={packageRecovery} order={packageOrder} reviewMatches={!packageOrder?.review||(brief.facts===packageOrder.review.facts&&brief.name===packageOrder.review.name)} initialName={brief.name} prepare={preparePackageInput} onRecovery={writePackageRecovery} onOrder={receivePackageOrder} context={{platform:brief.platform,region:brief.region,language:brief.language}} onResume={resumePackage} onConfirmed={(facts,style,name)=>patch({name,facts,visualStrategy:style,analysisReview:{referenceSignature,facts,styleSummary:style}})}/>:scene==='detail'?<CommerceAnalysisPanel onManual={()=>patch({analysisReview:undefined})} signature={referenceSignature} onAnalyze={analyzeImages} onConfirm={(facts,style,signature)=>{if(signature===referenceSignature)patch({facts,visualStrategy:style,analysisReview:{referenceSignature:signature,facts,styleSummary:style}});}}/>:undefined}
    referenceSource={referenceSource} setReferenceSource={setReferenceSource} sceneTab={sceneTab} setSceneTab={setSceneTab}
    referenceInstruction={ref => referenceInstructions[referenceKey(ref)] ?? ''} setReferenceInstruction={(ref, value) => { invalidatePreview(); setReferenceInstructions(current => ({ ...current, [referenceKey(ref)]: value })); }}
    scene={scene} brief={brief} patch={patch} references={references} roleOf={roleOf}
    addFiles={(files, role) => {
      const incoming = Array.from(files);
      const max = role === 'style' && scene === 'clone' ? 20 : 6;
      if (incoming.some(file => file.size > 10 * 1024 * 1024)) { setError('请选择每张不超过 10 MB 的 PNG、JPG 或 WebP 图片。'); return; }
      if (references.filter(ref => roleOf(ref) === role).length + incoming.length > max) { setError(`此类图片最多 ${max} 张。`); return; }
      invalidatePreview(); setError(undefined);
      setRoles(current => ({ ...current, ...Object.fromEntries(incoming.map(file => [`${file.name}:${file.size}:${file.lastModified}`, role])) }));
      onReferenceAdd(files);
    }} remove={onReferenceRemove} settings={generationSettings} capabilities={capabilities}
    changeSettings={value => {
      invalidatePreview();
      const next = { ...generationSettings, ...value };
      const model = capabilities.find(c => c.provider === next.provider)?.models.find(m => m.id === next.model);
      if (model && !model.aspectRatios.includes(next.aspectRatio)) next.aspectRatio = model.aspectRatios[0]!;
      if (model && !model.resolutions.includes(next.resolution)) next.resolution = model.resolutions[0]!;
      if (value.aspectRatio) setTouchedPresets(current => ({ ...current, aspectRatio: true }));
      setGenerationSettings(next); setPlan(current => current ? { ...current, slots: current.slots.map(slot => ({ ...slot, ...next })) } : current);
    }}
    setPlatform={value => { const preset = PLATFORM_PRESETS[value]; patch({ platform: value as CommerceBrief['platform'], ...(!touchedPresets.region && preset ? { region: preset.region } : {}), ...(!touchedPresets.language && preset ? { language: preset.language } : {}) }); if (!touchedPresets.aspectRatio && preset) setGenerationSettings(current => ({ ...current, aspectRatio: preset.aspectRatio })); }}
    setRegion={value => { setTouchedPresets(current => ({ ...current, region: true })); patch({ region: value as CommerceBrief['region'] }); }}
    setLanguage={value => { setTouchedPresets(current => ({ ...current, language: true })); patch({ language: value as CommerceBrief['language'] }); }}
    templateId={templateId} setTemplate={value => { invalidatePreview(); setTemplateId(value); }} count={count} setCount={value => { invalidatePreview(); setCount(value); }}
    counts={categoryCounts} setCounts={value => { invalidatePreview(); setCategoryCounts(value); }} layouts={sellingLayouts} setLayouts={value => { invalidatePreview(); setSellingLayouts(value as typeof SELLING_LAYOUTS[number][]); }}
    modules={detailModules} setModules={value => { invalidatePreview(); setDetailModules(value); }} advanced={advancedAplus} setAdvanced={value => { invalidatePreview(); setAdvancedAplus(value); }}
    stage={editorStage} setStage={setEditorStage} instruction={instruction} setInstruction={value => { invalidatePreview(); setInstruction(value); }}
    plan={plan} setPlan={setPlan} showPlan={Boolean(showPlan)} selectedSlotId={selectedSlotId} selectSlot={setSelectedSlotId}
    prepare={prepare} save={save} close={onClose} importUrl={importReferenceUrl} generateStrategy={generateStrategy} generateListing={generateListingCopy}
    textFee={packageFlow?<span>已包含在整套预算中</span>:<CreditFee items={[{ operation: 'optimize', provider: 'doubao', model: 'doubao', resolution: '', count: 1 }]} />}
    fee={packageFlow?<span>{packageOrder?'最高冻结 '+formatCredits(packageOrder.quote.totalMinor)+' 积分':'请先确认整套预算'}</span>:<CreditFee items={feeSlots.map(slot => imageCreditItem({ ...slot, count: 1 }))} />}
    productContext={productContext} chatModel={'doubao'} setChatModel={setSelectedChatModel}
    busy={busy} recovering={recoveringCreate} active={active} error={error} total={plannedCount}
    unavailableModel={unavailableModel}
    resetModel={resetModel}
  />;
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
                  {(scene === 'style-reference' || scene === 'clone') && <label>{scene === 'clone' ? '复刻参考图（最多 20 张）' : '风格参考图'}
                    <input aria-label="上传风格参考图" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => {
                      if (event.target.files) {
                        const additions = Object.fromEntries(Array.from(event.target.files).map(file => [`${file.name}:${file.size}:${file.lastModified}`, 'style' as const]));
                        setRoles(current => ({ ...current, ...additions }));
                        onReferenceAdd(event.target.files);
                      }
                      event.target.value = '';
                    }} />
                  </label>}
                  {scene === 'clone' && <div className={styles.urlImport}><label>公开商品链接<input aria-label="公开商品链接" type="url" placeholder="https://..." value={brief.sourceUrl ?? ''} onChange={event => patch({ sourceUrl: event.target.value || undefined })} /></label>
                    <button type="button" disabled={busy || !brief.sourceUrl} onClick={() => void importReferenceUrl()}>从链接导入参考图</button>
                    <p className={styles.note}>若网站限制访问或没有公开图片，链接会保留；可直接上传截图。</p>
                  </div>}
                  {scene === 'product-main' && <label>背景参考图（可选）<input aria-label="上传背景参考图" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => {
                    if (event.target.files) {
                      const additions = Object.fromEntries(Array.from(event.target.files).map(file => [`${file.name}:${file.size}:${file.lastModified}`, 'style' as const]));
                      setRoles(current => ({ ...current, ...additions })); onReferenceAdd(event.target.files);
                    }
                    event.target.value = '';
                  }} /></label>}
                  <p className={styles.note}>
                    商品原图最多 6 张{scene === 'clone' ? '，复刻参考图最多 20 张' : ''}，每张不超过 10 MB。
                  </p>
                  <div className={styles.references}>
                    {references.map((reference, index) => (
                      <div key={referenceKey(reference)}>
                        {reference.previewUrl && (
                          <PreviewImage
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
                  {scene === 'clone' && <label>复刻方式<CommerceSelect aria-label="复刻方式" value={brief.cloneMode ?? 'style'} onChange={value => patch({ cloneMode: value as CommerceBrief['cloneMode'] })}>
                    <option value="style">参考风格</option><option value="faithful">高度复刻</option>
                  </CommerceSelect></label>}
                  <details className={styles.advancedOptions} open={contentOnly || undefined}>
                    <summary>高级设置 · 平台、风格、数量与分图</summary>
                  <label>文字优化模型<CommerceSelect aria-label="文字优化模型" disabled={busy || recoveringCreate}
                    value={'doubao'} onChange={setSelectedChatModel}>
                    <option value="doubao">豆包</option>
                  </CommerceSelect></label>
                  <CreativeTextField productContext={productContext} field={contentOnly ? "title" : "name"} label={contentOnly ? "海报标题" : "商品名称"} maxLength={160} value={brief.name} onChange={(name) => patch({ name })} />
                  <div className={styles.twoColumns}>
                    <label>
                      平台
                      <CommerceSelect
                        disabled={busy || recoveringCreate || isPoster}
                        aria-label="创作平台"
                        value={brief.platform}
                        onChange={(value) => {
                          const preset = PLATFORM_PRESETS[value];
                          patch({ platform: value as CommerceBrief['platform'],
                            ...(!touchedPresets.region && preset ? { region: preset.region } : {}),
                            ...(!touchedPresets.language && preset ? { language: preset.language } : {}) });
                          if (!touchedPresets.aspectRatio && preset) setGenerationSettings(current => ({ ...current, aspectRatio: preset.aspectRatio }));
                        }}
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
                  {!isPoster && <div className={styles.twoColumns}>
                    <label>地区<CommerceSelect aria-label="目标地区" value={brief.region ?? PLATFORM_PRESETS[brief.platform]?.region ?? 'cn'} onChange={value => { setTouchedPresets(current => ({ ...current, region: true })); patch({ region: value as CommerceBrief['region'] }); }}>
                      {COMMERCE_REGIONS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </CommerceSelect></label>
                    <label>语言<CommerceSelect aria-label="画面语言" value={brief.language ?? PLATFORM_PRESETS[brief.platform]?.language ?? 'zh-CN'} onChange={value => { setTouchedPresets(current => ({ ...current, language: true })); patch({ language: value as CommerceBrief['language'] }); }}>
                      {COMMERCE_LANGUAGES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </CommerceSelect></label>
                  </div>}
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
                  {scene === 'product-set' && <div className={styles.twoColumns}>
                    {(['white', 'selling', 'scene', 'other'] as const).map(category => <label key={category}>{({ white: '白底图', selling: '卖点图', scene: '场景图', other: '其他图' })[category]}数量
                      <CommerceSelect aria-label={`${category}图片数量`} value={categoryCounts[category]} onChange={value => { invalidatePreview(); setCategoryCounts(current => ({ ...current, [category]: Number(value) })); }}>
                        {Array.from({ length: 21 }, (_, index) => <option key={index} value={index}>{index}</option>)}
                      </CommerceSelect></label>)}
                    <p className={styles.note}>共 {plannedCount} 张，最多 20 张。</p>
                  </div>}
                  {scene === 'detail' && <div>
                    <label>输出规格<CommerceSelect aria-label="A+ 输出规格" value={advancedAplus ? 'advanced' : 'standard'} onChange={value => { invalidatePreview(); setAdvancedAplus(value === 'advanced'); }}>
                      <option value="standard">普通 A+ · 970 × 600</option><option value="advanced">高级 A+ · 桌面 1464 × 600 + 移动 600 × 450</option>
                    </CommerceSelect></label>
                    <p className={styles.note}>详情模块（最多 16 个）· 按选择顺序生成</p>
                    <div className={styles.moduleChoices}>{DETAIL_MODULES.map(module => <label key={module}><input type="checkbox" checked={detailModules.includes(module)} onChange={event => { invalidatePreview(); setDetailModules(current => event.target.checked ? [...current, module] : current.filter(item => item !== module)); }} />{module}</label>)}</div>
                    <ol className={styles.moduleOrder}>{detailModules.map((module, index) => <li key={module}>{module}
                      <button type="button" aria-label={`上移${module}`} disabled={index === 0} onClick={() => { invalidatePreview(); setDetailModules(current => { const next = [...current]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; }); }}>↑</button>
                      <button type="button" aria-label={`下移${module}`} disabled={index === detailModules.length - 1} onClick={() => { invalidatePreview(); setDetailModules(current => { const next = [...current]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next; }); }}>↓</button>
                    </li>)}</ol>
                    <p className={styles.note}>共 {plannedCount} 张，生成前可编辑每个模块的图片角色与文案。</p>
                    <button type="button" disabled={busy} onClick={() => void generateStrategy()}>AI 生成视觉策略与模块文案（按现有文字积分计费）</button>
                    <label>视觉策略<textarea aria-label="视觉策略" maxLength={2000} rows={4} value={brief.visualStrategy ?? ''} onChange={event => patch({ visualStrategy: event.target.value })} /></label>
                    {detailModules.map(module => <label key={module}>{module}文案<textarea aria-label={`${module}模块文案`} maxLength={1000} rows={2} value={brief.moduleCopy?.[module] ?? ''} onChange={event => patch({ moduleCopy: { ...brief.moduleCopy, [module]: event.target.value } })} /></label>)}
                  </div>}
                  {scene === 'product-set' && <details className={styles.advancedOptions}><summary>上架文案（可选）</summary>
                    <button type="button" disabled={busy} onClick={() => void generateListingCopy()}>AI 编写上架文案（按现有文字积分计费）</button>
                    {(['title', 'highlights', 'description', 'keywords'] as const).map(key => <label key={key}>{({ title: '标题', highlights: '核心卖点', description: '详情描述', keywords: '关键词' })[key]}
                      <textarea aria-label={`上架文案${key}`} rows={key === 'description' ? 4 : 2} value={brief.listingCopy?.[key] ?? ''} onChange={event => patch({ listingCopy: { title: brief.listingCopy?.title ?? '', highlights: brief.listingCopy?.highlights ?? '', description: brief.listingCopy?.description ?? '', keywords: brief.listingCopy?.keywords ?? '', [key]: event.target.value } })} />
                    </label>)}
                    <button type="button" onClick={() => void navigator.clipboard.writeText(Object.values(brief.listingCopy ?? {}).join('\n'))}>复制文案</button>
                    <button type="button" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify({ facts: brief.facts, suggested: brief.listingCopy }, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'listing-copy.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }}>导出文案</button>
                  </details>}
                  {scene !== 'product-set' && scene !== 'detail' && scene !== 'clone' && <label>
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
                      {Array.from({ length: maxCommerceSlots(scene) }, (_, index) => (
                        <option key={index + 1}>{index + 1}</option>
                      ))}
                    </CommerceSelect>
                  </label>}
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
                    {scene === 'detail' ? <p className={styles.note}>A+ 会按输出规格选择接近成品的原生比例：桌面 16:9，移动 4:3；导出时可调整横向裁切。</p> : <label>画面比例<CommerceSelect aria-label="电商画面比例" value={generationSettings.aspectRatio} onChange={value => { invalidatePreview(); setTouchedPresets(current => ({ ...current, aspectRatio: true })); setGenerationSettings(current => ({ ...current, aspectRatio: value as CommerceSlot['aspectRatio'] })); }}>
                      {capabilities.find(item => item.provider === generationSettings.provider)?.models.find(item => item.id === generationSettings.model)?.aspectRatios.map(value => <option key={value}>{value}</option>)}
                    </CommerceSelect></label>}
                  </details>
              </fieldset>
            </div>
            {error && <p role="alert">{error}</p>}
            {unavailableModel && !recoveringCreate && <p role="alert">{IMAGE_MODEL_UPGRADE_MESSAGE}<button type="button" disabled={busy} onClick={resetModel}>使用当前默认参数创建新版本</button></p>}
            {recoveringCreate && !busy && <p className={styles.note}>已保留本次方案，点击生成或保存将恢复同一任务。</p>}
            <div className={`${styles.actions} ${styles.wizardControls}`}>
              <div className={styles.generationSummary}><p className={styles.note}>
                本次生成 {step === 3 ? plan?.slots.length : plannedCount}{" "}
                张
              </p>
              <CreditFee items={feeSlots.map(slot => imageCreditItem({ ...slot, count: 1 }))} /></div>
              <button className={styles.primary} disabled={busy || !active || (unavailableModel && !recoveringCreate) || plannedCount < 1 || plannedCount > maxCommerceSlots(scene, advancedAplus)} onClick={() => void save(true)}>{busy ? '正在准备…' : `一键生成 ${step === 3 ? plan?.slots.length ?? plannedCount : plannedCount} 张`}</button>
              {(plannedCount < 1 || plannedCount > maxCommerceSlots(scene, advancedAplus)) && <p role="alert">请选择 1–{maxCommerceSlots(scene, advancedAplus)} 张图片。</p>}
              <button disabled={busy || !active || (unavailableModel && !recoveringCreate)} onClick={() => void prepare()}>调整分图方案</button>
              <button disabled={busy || !active || (unavailableModel && !recoveringCreate)} onClick={() => void save()}>保存草稿</button>
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
              <span>{plannedCount} 张图片</span>
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
                  {Array.from({ length: Math.min(plannedCount, 32) }, (_, index) => (
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
