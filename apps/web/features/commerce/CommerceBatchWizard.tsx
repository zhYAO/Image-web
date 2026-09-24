'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { APLUS_SPECS, aPlusAspectRatio, COMMERCE_LANGUAGES, COMMERCE_PLATFORMS, COMMERCE_REGIONS, DETAIL_MODULES, PLATFORM_PRESETS, buildCommerceSlots, formatCredits, imageCreditItem, quoteCredits, validateCommercePlan, creativeBatchSchema, type CommerceBrief, type CommerceGateway, type CommercePlan, type CommerceSlot, type CommerceTask, type CreativeBatch, type ProviderCapability, type UploadReference } from '@zimage/domain';
import { CreditFee, useCredits } from '@/features/credits/CreditsProvider';
import { CommerceSelect } from './CommerceSelect';
import { downloadCommerceFile } from './commerce-ui';
import { sessionHref } from '@/features/workspace/workspace-route';
import styles from './commerce.module.css';

type Workflow = 'product-set' | 'detail' | 'clone';
type GenerationSettings = Pick<CommerceSlot, 'provider' | 'model' | 'aspectRatio' | 'resolution'>;
type ProductRow = { id: string; name: string; description: string; sellingPoints: string; instruction: string; platform?: CommerceBrief['platform']; region?: CommerceBrief['region']; language?: CommerceBrief['language']; generation?: GenerationSettings; count?: number; advanced?: boolean; cloneMode?: CommerceBrief['cloneMode']; products: File[]; references: File[] };
const newRow = (): ProductRow => ({ id: crypto.randomUUID(), name: '', description: '', sellingPoints: '', instruction: '', products: [], references: [] });
const fileReference = (file: File): UploadReference => ({ file, mimeType: file.type, name: file.name, size: file.size, status: 'ready' });
const checkFiles = (files: File[], max: number) => {
  if (files.length > max) throw new Error(`最多上传 ${max} 张图片。`);
  if (files.some(file => !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) throw new Error('仅支持每张不超过 10 MB 的 JPG、PNG 或 WebP。');
};
const parseBatch = async (response: Response) => {
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || '批量请求失败，请稍后重试。');
  return creativeBatchSchema.parse(body);
};
const mockBatchKey = 'zimage:commerce-batches:mock:v1';
const batchDraftKey = 'zimage:commerce-batch-draft:v1';
const mockMode = process.env.NEXT_PUBLIC_DATA_MODE === 'mock';
const readMockBatches = (): CreativeBatch[] => {
  try { return (JSON.parse(localStorage.getItem(mockBatchKey) ?? '[]') as unknown[]).map(item => creativeBatchSchema.parse(item)); }
  catch { return []; }
};
const saveMockBatch = (batch: CreativeBatch) => localStorage.setItem(mockBatchKey, JSON.stringify([batch, ...readMockBatches().filter(item => item.id !== batch.id)]));
const readBatchDraft = (): { workflow: Workflow; platform: CommerceBrief['platform']; language: NonNullable<CommerceBrief['language']>; region: NonNullable<CommerceBrief['region']>; generation: GenerationSettings; count: number; advanced: boolean; rows: ProductRow[]; touched?: { region: boolean; language: boolean; aspectRatio: boolean } } | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    const saved = JSON.parse(localStorage.getItem(batchDraftKey) ?? 'null');
    if (!saved || !Array.isArray(saved.rows)) return undefined;
    return { ...saved, rows: saved.rows.slice(0, 20).map((row: ProductRow) => ({ ...row, products: [], references: [] })) };
  } catch { return undefined; }
};

export function CommerceBatchWizard({ gateway, sessionId, ensureSession, settings, capabilities, batchId, onCreated }: {
  gateway?: CommerceGateway; sessionId: string; ensureSession?: (title: string, requestId: string) => Promise<string>;
  settings: Pick<CommerceSlot, 'provider' | 'model' | 'aspectRatio' | 'resolution'>; capabilities: ProviderCapability[];
  batchId?: string; onCreated?: (batch: CreativeBatch, sourceId: string) => void;
}) {
  const credits = useCredits();
  const [restored] = useState(readBatchDraft);
  const [workflow, setWorkflow] = useState<Workflow>(restored?.workflow ?? 'product-set');
  const [platform, setPlatform] = useState<CommerceBrief['platform']>(restored?.platform ?? 'taobao');
  const [language, setLanguage] = useState(restored?.language ?? 'zh-CN');
  const [region, setRegion] = useState(restored?.region ?? 'cn');
  const [generation, setGeneration] = useState(restored?.generation ?? settings);
  const [count, setCount] = useState(restored?.count ?? 7);
  const [advanced, setAdvanced] = useState(restored?.advanced ?? false);
  const [touched, setTouched] = useState(restored?.touched ?? { region: false, language: false, aspectRatio: false });
  const [rows, setRows] = useState<ProductRow[]>(() => restored?.rows.length ? restored.rows : [newRow()]);
  const [batch, setBatch] = useState<CreativeBatch>();
  const [tasks, setTasks] = useState<Record<string, CommerceTask>>({});
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const uploadIds = useRef(new Map<File, string>());
  const submission = useRef<{ requestId: string; sessionRequestId: string }>({ requestId: crypto.randomUUID(), sessionRequestId: crypto.randomUUID() });
  const recoveryKey = `zimage:commerce-batch:${sessionId}`;
  const perRowCount = workflow === 'detail' ? DETAIL_MODULES.slice(0, 6).length * (advanced ? 2 : 1) : workflow === 'clone' ? 1 : count;
  const quoteItems = useMemo(() => rows.flatMap(row => Array.from({ length: workflow === 'clone' ? Math.max(1, row.references.length) : workflow === 'detail' ? (row.advanced ?? advanced) ? 12 : 6 : row.count ?? perRowCount }, () => imageCreditItem({ ...(row.generation ?? generation), count: 1 }))), [rows, workflow, advanced, generation, perRowCount]);
  const quote = credits.catalog ? (() => { try { return quoteCredits(credits.catalog!, quoteItems); } catch { return undefined; } })() : undefined;
  const update = (id: string, patch: Partial<ProductRow>) => setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
  useEffect(() => {
    if (batchId || batch) return;
    localStorage.setItem(batchDraftKey, JSON.stringify({ workflow, platform, language, region, generation, count, advanced, touched, rows: rows.map(row => ({ id: row.id, name: row.name, description: row.description, sellingPoints: row.sellingPoints, instruction: row.instruction, platform: row.platform, region: row.region, language: row.language, generation: row.generation, count: row.count, advanced: row.advanced, cloneMode: row.cloneMode })) }));
  }, [batchId, batch, workflow, platform, language, region, generation, count, advanced, touched, rows]);

  useEffect(() => {
    if (batchId) return;
    const raw = sessionStorage.getItem(recoveryKey);
    if (!raw) return;
    let active = true;
    try {
      const previous = JSON.parse(raw) as { requestId: string; sessionId: string };
      if (mockMode) {
        const found = readMockBatches().find(item => item.requestId === previous.requestId && item.sessionId === previous.sessionId);
        if (found) { sessionStorage.removeItem(recoveryKey); onCreated?.(found, sessionId); }
        return;
      }
      void fetch(`/api/creative-batches?sessionId=${encodeURIComponent(previous.sessionId)}`, { cache: 'no-store' })
        .then(response => response.ok ? response.json() : [])
        .then(value => {
          if (!active || !Array.isArray(value)) return;
          const found = value.map(item => creativeBatchSchema.safeParse(item)).find(item => item.success && item.data.requestId === previous.requestId);
          if (found?.success) { sessionStorage.removeItem(recoveryKey); onCreated?.(found.data, sessionId); }
        }).catch(() => undefined);
    } catch { sessionStorage.removeItem(recoveryKey); }
    return () => { active = false; };
  }, [batchId, recoveryKey, onCreated, sessionId]);

  useEffect(() => {
    if (!batchId) return;
    let stopped = false;
    let advancing = false;
    const refresh = async () => {
      if (advancing) return;
      advancing = true;
      try {
        let current = mockMode ? readMockBatches().find(item => item.id === batchId) : await parseBatch(await fetch(`/api/creative-batches/${batchId}`, { cache: 'no-store' }));
        if (!current) throw new Error('批量任务不存在。');
        if (stopped) return;
        if (mockMode && gateway) {
          const item = current.items.find(entry => entry.status === 'pending' || entry.status === 'created');
          if (item) {
            try {
              if (!item.taskId) {
                const task = await gateway.create({ requestId: item.createRequestId, sessionId: current.sessionId, plan: item.plan });
                item.taskId = task.id; item.status = 'created'; saveMockBatch(current);
              }
              await gateway.submit(item.taskId!, { requestId: item.submitRequestId, revision: 1, slotIds: item.plan.slots.map(slot => slot.id), billing: item.billing, recreate: false, source: 'direct' });
              item.status = 'submitted'; item.error = undefined;
            } catch (cause) { item.error = cause instanceof Error ? cause.message : '子任务提交失败'; item.status = 'failed'; }
            current = { ...current, items: [...current.items], updatedAt: new Date().toISOString() }; saveMockBatch(current);
          }
        } else if (current.items.some(item => item.status === 'pending' || item.status === 'created'))
          current = await parseBatch(await fetch(`/api/creative-batches/${batchId}`, { method: 'POST' }));
        if (stopped) return;
        setBatch(current);
        if (gateway) {
          const loaded = await Promise.all(current.items.filter(item => item.taskId).map(async item => {
            try { return [item.id, await gateway.get(item.taskId!)] as const; } catch { return undefined; }
          }));
          if (!stopped) setTasks(Object.fromEntries(loaded.filter((entry): entry is readonly [string, CommerceTask] => Boolean(entry))));
        }
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : '无法恢复批量任务。'); }
      finally { advancing = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [batchId, gateway]);

  const upload = async (targetSession: string, file: File) => {
    const prior = uploadIds.current.get(file); if (prior) return prior;
    if (!gateway) throw new Error('电商服务尚未连接。');
    const id = await gateway.upload(targetSession, fileReference(file)); uploadIds.current.set(file, id); return id;
  };
  const downloadBatch = async (id: string) => {
    try {
      if (mockMode && gateway && batch) {
        for (const item of batch.items) {
          const task = tasks[item.id];
          if (task?.selections.length) await downloadCommerceFile(gateway, task, task.selections.map(selection => selection.slotId), 'zip', 'jpg');
        }
        return;
      }
      const response = await fetch(`/api/creative-batches/${id}/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format: 'jpg' }) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || '批量下载失败。');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `commerce-batch-${id}.zip`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '批量下载失败。'); }
  };
  const makePlan = async (row: ProductRow, targetSession: string): Promise<CommercePlan> => {
    checkFiles(row.products, 6); checkFiles(row.references, workflow === 'clone' ? 20 : 8);
    if (workflow === 'clone' ? !row.references.length : !row.products.length) throw new Error(`「${row.name || '未命名商品'}」缺少${workflow === 'clone' ? '复刻参考图' : '商品原图'}。`);
    const productReferenceIds = await Promise.all(row.products.map(file => upload(targetSession, file)));
    const styleReferenceIds = await Promise.all(row.references.map(file => upload(targetSession, file)));
    const brief: CommerceBrief = { name: row.name.trim() || row.description.trim().slice(0, 160) || (workflow === 'clone' ? '参考图复刻' : ''), description: row.description, facts: '', sellingPoints: row.sellingPoints, platform: row.platform ?? platform,
      placement: workflow === 'detail' ? '商品详情' : '商品展示', productReferenceIds, styleReferenceIds, region: row.region ?? region, language: row.language ?? language, cloneMode: workflow === 'clone' ? row.cloneMode ?? 'style' : undefined };
    const imageCount = workflow === 'clone' ? styleReferenceIds.length : workflow === 'detail' ? (row.advanced ?? advanced) ? 12 : 6 : row.count ?? perRowCount;
    const slots = buildCommerceSlots(brief, workflow, imageCount, row.generation ?? generation).map((slot, index) => {
      if (workflow === 'clone') return { ...slot, role: `参考图 ${index + 1}`, instruction: row.instruction, referenceIds: [...productReferenceIds, styleReferenceIds[index]!] };
      if (workflow === 'detail') {
        const detailModule = DETAIL_MODULES[index % 6]!;
        const outputSpec: CommerceSlot['outputSpec'] = (row.advanced ?? advanced) ? index < 6 ? 'desktop' : 'mobile' : 'standard';
        return { ...slot, role: detailModule, module: detailModule, outputSpec, aspectRatio: aPlusAspectRatio(outputSpec), targetWidth: APLUS_SPECS[outputSpec].width, targetHeight: APLUS_SPECS[outputSpec].height, instruction: row.instruction };
      }
      const category: CommerceSlot['category'] = index === 0 ? 'white' : index <= 2 ? 'selling' : index <= 4 ? 'scene' : 'other';
      return { ...slot, role: category === 'white' ? '白底商品图' : category === 'selling' ? '核心卖点' : category === 'scene' ? '使用场景' : '商品说明', category, instruction: row.instruction, textMode: category === 'white' || brief.language === 'none' ? 'none' as const : 'auto' as const };
    });
    const plan: CommercePlan = { scene: workflow, brief, templateId: workflow === 'detail' ? 'detail-hero' : 'soft-studio', slots };
    validateCommercePlan(brief, workflow, slots, plan.templateId);
    return plan;
  };
  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(undefined);
    try {
      if (!gateway) throw new Error('电商服务尚未连接。');
      if (!rows.length || rows.length > 20) throw new Error('每批添加 1–20 个商品任务。');
      if (new Set(rows.flatMap(row => [...row.products, ...row.references])).size > 64) throw new Error('当前会话最多保留 64 张参考图，请减少图片或分批生成。');
      for (const [index, row] of rows.entries()) {
        checkFiles(row.products, 6);
        checkFiles(row.references, workflow === 'clone' ? 20 : 8);
        if (workflow === 'clone' ? !row.references.length : !row.products.length) throw new Error(`商品任务 ${index + 1} 缺少${workflow === 'clone' ? '复刻参考图' : '商品原图'}。`);
        if (workflow !== 'clone' && !row.name.trim() && !row.description.trim()) throw new Error(`请填写商品任务 ${index + 1} 的名称或描述。`);
      }
      if (!quote) throw new Error('报价尚未准备好，请稍后重试。');
      if (quote && credits.wallet && quote.totalMinor > credits.wallet.availableMinor) throw new Error('本次批量报价超过可用积分。');
      if (!confirming) { setConfirming(true); return; }
      const targetSession = sessionId.startsWith('commerce-draft:') ? await ensureSession?.(rows[0]?.name || '批量电商图', submission.current.sessionRequestId) : sessionId;
      if (!targetSession || targetSession.startsWith('commerce-draft:')) throw new Error('无法创建批量会话，请重试。');
      if (!mockMode) {
        const capacityResponse = await fetch(`/api/uploads?sessionId=${encodeURIComponent(targetSession)}`, { cache: 'no-store' });
        const capacity = await capacityResponse.json().catch(() => null) as { count?: number; limit?: number; message?: string } | null;
        if (!capacityResponse.ok) throw new Error(capacity?.message || '无法核对当前会话参考图容量。');
        if (typeof capacity?.count !== 'number' || typeof capacity.limit !== 'number') throw new Error('无法核对当前会话参考图容量。');
        if (capacity.count + new Set(rows.flatMap(row => [...row.products, ...row.references])).size > capacity.limit) throw new Error(`本次图片加上会话已有参考图超过 ${capacity.limit} 张，请减少图片或新建批次。`);
      }
      sessionStorage.setItem(recoveryKey, JSON.stringify({ requestId: submission.current.requestId, sessionId: targetSession }));
      const plans = await Promise.all(rows.map(row => makePlan(row, targetSession)));
      const tasks = plans.map((plan, index) => ({ plan, billing: credits.confirm(plan.slots.map(slot => imageCreditItem({ ...slot, count: 1 }))), overrides: { instruction: rows[index]!.instruction, platform: rows[index]!.platform, region: rows[index]!.region, language: rows[index]!.language, generation: rows[index]!.generation, count: rows[index]!.count, advanced: rows[index]!.advanced, cloneMode: rows[index]!.cloneMode } }));
      const created = mockMode ? (() => {
        const existing = readMockBatches().find(item => item.requestId === submission.current.requestId);
        if (existing) return existing;
        const now = new Date().toISOString();
        const next = creativeBatchSchema.parse({ id: crypto.randomUUID(), requestId: submission.current.requestId, sessionId: targetSession, workflow, globalParams: { platform, region, language, generation, count, advanced }, createdAt: now, updatedAt: now,
          items: tasks.map(task => ({ id: crypto.randomUUID(), createRequestId: crypto.randomUUID(), submitRequestId: crypto.randomUUID(), ...task, status: 'pending' })) });
        saveMockBatch(next); return next;
      })() : await parseBatch(await fetch('/api/creative-batches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: submission.current.requestId, sessionId: targetSession, workflow, globalParams: { platform, region, language, generation, count, advanced }, tasks }) }));
      setBatch(created); localStorage.removeItem(batchDraftKey); sessionStorage.removeItem(recoveryKey); onCreated?.(created, sessionId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '批量提交失败，请重试。'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  if (batchId || batch) {
    const current = batch;
    return <section className={styles.batchWorkbench} aria-label="批量任务进度"><h2>批量生成进度</h2>
      {error && <p role="alert">{error}</p>}
      {!current ? <p role="status">正在恢复批量任务…</p> : <>
        <p role="status">已提交 {current.items.filter(item => item.status === 'submitted').length}/{current.items.length} 个商品任务；失败 {current.items.filter(item => item.status === 'failed').length} 个。图片继续由现有队列生成。</p>
        <ol>{current.items.map((item, index) => {
          const task = tasks[item.id];
          const images = task?.runs.flatMap(run => run.items) ?? [];
          const completed = images.filter(image => image.status === 'succeeded').length;
          const failed = images.filter(image => image.status === 'failed').length;
          return <li key={item.id}><strong>{index + 1}. {item.plan.brief.name}</strong> · {item.status === 'submitted' ? `图片 ${completed}/${item.plan.slots.length} 完成${failed ? `，${failed} 失败` : ''}` : item.status === 'failed' ? '提交失败' : '等待提交'}
            {item.error && <span role="alert"> · {item.error}</span>}
            {item.taskId && <a href={sessionHref(current.sessionId, item.taskId, 'results')}>查看任务与重试</a>}
            {task && completed > 0 && gateway && <button onClick={() => void downloadCommerceFile(gateway, task, task.selections.map(selection => selection.slotId), 'zip', 'jpg').catch(cause => setError(cause.message))}>下载该商品 ZIP</button>}
          </li>;
        })}</ol>
        <button disabled={!current.items.some(item => tasks[item.id]?.selections.length)} onClick={() => void downloadBatch(current.id)}>{mockMode ? '逐商品下载模拟结果' : '批量下载已完成商品 ZIP'}</button>
      </>}
    </section>;
  }
  const model = capabilities.find(item => item.provider === generation.provider)?.models.find(item => item.id === generation.model);
  return <section className={styles.batchWorkbench} aria-label="即时批量生成"><h2>批量生成</h2><p>统一参数 → 添加商品 → 逐项覆盖 → 核对费用并提交</p><p className={styles.note}>每批最多 20 个商品任务；当前会话最多保留 64 张参考图，上传仍受每日额度限制。</p>{restored && <p className={styles.note}>已恢复批量参数与文字草稿；请重新选择本地商品图片。</p>}
    <div className={styles.batchGlobal}>
      <label>生成类型<CommerceSelect aria-label="批量生成类型" value={workflow} onChange={value => { setWorkflow(value as Workflow); setError(undefined); }}><option value="product-set">商品套图</option><option value="detail">A+ 详情页</option><option value="clone">爆款图复刻</option></CommerceSelect></label>
      <label>统一平台<CommerceSelect aria-label="批量统一平台" value={platform} onChange={value => { const next = value as CommerceBrief['platform']; setPlatform(next); if (!touched.region) setRegion(PLATFORM_PRESETS[next]?.region ?? region); if (!touched.language) setLanguage(PLATFORM_PRESETS[next]?.language ?? language); if (!touched.aspectRatio) setGeneration(current => ({ ...current, aspectRatio: PLATFORM_PRESETS[next]?.aspectRatio ?? current.aspectRatio })); }}>
        {COMMERCE_PLATFORMS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </CommerceSelect></label>
      <label>生成模型<CommerceSelect aria-label="批量生成模型" value={`${generation.provider}::${generation.model}`} onChange={value => { const [provider, name] = value.split('::'); const match = capabilities.find(item => item.provider === provider)?.models.find(item => item.id === name); if (provider && name && match) setGeneration(current => ({ ...current, provider, model: name, resolution: match.resolutions.includes(current.resolution) ? current.resolution : match.resolutions[0]!, aspectRatio: match.aspectRatios.includes(current.aspectRatio) ? current.aspectRatio : match.aspectRatios[0]! })); }}>
        {capabilities.flatMap(provider => provider.models.map(model => <option key={model.id} value={`${provider.provider}::${model.id}`}>{model.label}</option>))}
      </CommerceSelect></label>
      <label>分辨率<CommerceSelect aria-label="批量生成分辨率" value={generation.resolution} onChange={value => setGeneration(current => ({ ...current, resolution: value as CommerceSlot['resolution'] }))}>{model?.resolutions.map(resolution => <option key={resolution}>{resolution}</option>)}</CommerceSelect></label>
      <label>地区<CommerceSelect aria-label="批量目标地区" value={region} onChange={value => { setTouched(current => ({ ...current, region: true })); setRegion(value as NonNullable<CommerceBrief['region']>); }}>{COMMERCE_REGIONS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</CommerceSelect></label>
      <label>语言<CommerceSelect aria-label="批量画面语言" value={language} onChange={value => { setTouched(current => ({ ...current, language: true })); setLanguage(value as NonNullable<CommerceBrief['language']>); }}>{COMMERCE_LANGUAGES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</CommerceSelect></label>
      {workflow === 'detail' ? <p className={styles.note}>A+ 自动采用接近成品的模型比例：桌面 16:9，移动 4:3。</p> : <label>比例<CommerceSelect aria-label="批量生成比例" value={generation.aspectRatio} onChange={value => { setTouched(current => ({ ...current, aspectRatio: true })); setGeneration(current => ({ ...current, aspectRatio: value as CommerceSlot['aspectRatio'] })); }}>{model?.aspectRatios.map(ratio => <option key={ratio}>{ratio}</option>)}</CommerceSelect></label>}
      {workflow === 'product-set' && <label>每商品图片数量<CommerceSelect aria-label="批量每商品图片数量" value={count} onChange={value => setCount(Number(value))}>{Array.from({ length: 20 }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</CommerceSelect></label>}
      {workflow === 'detail' && <label>输出规格<CommerceSelect aria-label="批量 A+ 输出规格" value={advanced ? 'advanced' : 'standard'} onChange={value => setAdvanced(value === 'advanced')}><option value="standard">普通 A+（6 张）</option><option value="advanced">高级 A+ 桌面＋移动（12 张）</option></CommerceSelect></label>}
    </div>
    <div className={styles.batchRows}>{rows.map((row, index) => <fieldset key={row.id}><legend>商品任务 {index + 1}</legend>
      <label>{workflow === 'clone' ? '复刻参考图' : '商品原图'}<input aria-label={`商品 ${index + 1} ${workflow === 'clone' ? '复刻参考图' : '原图'}`} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => update(row.id, workflow === 'clone' ? { references: Array.from(event.target.files ?? []) } : { products: Array.from(event.target.files ?? []) })} /></label>
      {workflow === 'clone' && <label>替换商品图（可选）<input aria-label={`商品 ${index + 1} 替换图`} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => update(row.id, { products: Array.from(event.target.files ?? []) })} /></label>}
      <label>商品名称<input aria-label={`商品 ${index + 1} 名称`} value={row.name} onChange={event => update(row.id, { name: event.target.value })} /></label>
      <label>商品描述<textarea aria-label={`商品 ${index + 1} 描述`} value={row.description} onChange={event => update(row.id, { description: event.target.value })} /></label>
      <label>卖点<textarea aria-label={`商品 ${index + 1} 卖点`} value={row.sellingPoints} onChange={event => update(row.id, { sellingPoints: event.target.value })} /></label>
      <details><summary>覆盖统一参数</summary><label>平台<CommerceSelect aria-label={`商品 ${index + 1} 平台覆盖`} value={row.platform ?? ''} onChange={value => update(row.id, { platform: value ? value as CommerceBrief['platform'] : undefined })}><option value="">继承统一平台</option>{COMMERCE_PLATFORMS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</CommerceSelect></label>
        <label>地区<CommerceSelect aria-label={`商品 ${index + 1} 地区覆盖`} value={row.region ?? ''} onChange={value => update(row.id, { region: value ? value as CommerceBrief['region'] : undefined })}><option value="">继承统一地区</option>{COMMERCE_REGIONS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</CommerceSelect></label>
        <label>语言<CommerceSelect aria-label={`商品 ${index + 1} 语言覆盖`} value={row.language ?? ''} onChange={value => update(row.id, { language: value ? value as CommerceBrief['language'] : undefined })}><option value="">继承统一语言</option>{COMMERCE_LANGUAGES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</CommerceSelect></label>
        <label>模型<CommerceSelect aria-label={`商品 ${index + 1} 模型覆盖`} value={row.generation ? `${row.generation.provider}::${row.generation.model}` : ''} onChange={value => { const [provider, name] = value.split('::'); const match = capabilities.find(item => item.provider === provider)?.models.find(item => item.id === name); update(row.id, { generation: provider && name && match ? { provider, model: name, resolution: match.resolutions.includes((row.generation ?? generation).resolution) ? (row.generation ?? generation).resolution : match.resolutions[0]!, aspectRatio: match.aspectRatios.includes((row.generation ?? generation).aspectRatio) ? (row.generation ?? generation).aspectRatio : match.aspectRatios[0]! } : undefined }); }}><option value="">继承统一模型</option>{capabilities.flatMap(provider => provider.models.map(model => <option key={model.id} value={`${provider.provider}::${model.id}`}>{model.label}</option>))}</CommerceSelect></label>
        {row.generation && <label>分辨率<CommerceSelect aria-label={`商品 ${index + 1} 分辨率覆盖`} value={row.generation.resolution} onChange={value => update(row.id, { generation: { ...row.generation!, resolution: value as CommerceSlot['resolution'] } })}>{capabilities.find(item => item.provider === row.generation!.provider)?.models.find(item => item.id === row.generation!.model)?.resolutions.map(resolution => <option key={resolution}>{resolution}</option>)}</CommerceSelect></label>}
        {workflow === 'product-set' && <label>图片数量<CommerceSelect aria-label={`商品 ${index + 1} 数量覆盖`} value={row.count ?? ''} onChange={value => update(row.id, { count: value ? Number(value) : undefined })}><option value="">继承统一数量</option>{Array.from({ length: 20 }, (_, value) => <option key={value + 1}>{value + 1}</option>)}</CommerceSelect></label>}
        {workflow === 'detail' && <label>A+ 规格<CommerceSelect aria-label={`商品 ${index + 1} A+规格覆盖`} value={row.advanced === undefined ? '' : row.advanced ? 'advanced' : 'standard'} onChange={value => update(row.id, { advanced: value ? value === 'advanced' : undefined })}><option value="">继承统一规格</option><option value="standard">普通 A+</option><option value="advanced">高级 A+</option></CommerceSelect></label>}
        {workflow === 'clone' && <label>复刻方式<CommerceSelect aria-label={`商品 ${index + 1} 复刻方式覆盖`} value={row.cloneMode ?? ''} onChange={value => update(row.id, { cloneMode: value ? value as CommerceBrief['cloneMode'] : undefined })}><option value="">继承参考风格</option><option value="style">参考风格</option><option value="faithful">高度复刻</option></CommerceSelect></label>}
        <label>额外要求<textarea aria-label={`商品 ${index + 1} 额外要求`} value={row.instruction} onChange={event => update(row.id, { instruction: event.target.value })} /></label>
      </details><button type="button" disabled={rows.length === 1} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>移除商品</button>
    </fieldset>)}</div>
    <div className={styles.actions}><button type="button" disabled={rows.length >= 20} onClick={() => setRows(current => [...current, newRow()])}>添加商品（最多 20 个）</button>
      <CreditFee items={quoteItems} /><button type="button" className={styles.primary} disabled={busy || !gateway} onClick={() => void submit()}>{busy ? '正在提交…' : confirming ? `确认提交 ${rows.length} 个商品任务` : `核对 ${rows.length} 个商品任务费用`}</button></div>
    {confirming && <div className={styles.batchConfirmation} role="dialog" aria-label="批量费用确认"><strong>确认批量提交</strong><p>{rows.length} 个商品任务 · {quoteItems.length} 张图片 · 预计 {quote ? formatCredits(quote.totalMinor) : '—'} 积分。逐项由现有队列生成，失败按实际结果结算。</p><button type="button" onClick={() => setConfirming(false)}>返回修改</button></div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
