'use client';

import { useEffect, useRef, useState } from 'react';
import { creativeBatchSchema, type CommerceGateway, type CommerceTask, type CreativeBatch } from '@zimage/domain';
import { z } from 'zod';
import { HttpCommerceGateway } from '@/gateways/http-commerce-gateway';
import { clientRuntime } from '@/features/platform/client-runtime';
import { sessionHref } from '@/features/workspace/workspace-route';
import { nextPollingDelay } from '@/features/workspace/bounded-polling';
import styles from './commerce.module.css';

const progressSchema = z.object({
  id: z.uuid(), createdAt: z.string(), updatedAt: z.string(), terminal: z.boolean(),
  items: z.array(z.object({ id: z.uuid(), taskId: z.uuid().nullable().optional(),
    status: z.enum(['pending', 'created', 'submitted', 'failed', 'needs_review']),
    error: z.string().nullable().optional(), total: z.number(), succeeded: z.number(),
    failed: z.number(), processing: z.number(), review: z.number() })),
});
type Progress = z.infer<typeof progressSchema>;
type History = { scope: string; batch?: CreativeBatch; progress?: Progress; tasks?: Record<string, CommerceTask>; error?: string };

export function LegacyCreativeBatchHistory({ ownerKey, sessionId, batchId, gateway }: {
  ownerKey: string; sessionId: string; batchId: string; gateway?: CommerceGateway;
}) {
  const mockMode = clientRuntime.isMockDataMode();
  const scope = JSON.stringify([ownerKey, sessionId, batchId]);
  const [history, setHistory] = useState<History>({ scope });
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const aliveRef = useRef<() => boolean>(() => false);
  const current = history.scope === scope ? history : undefined;

  useEffect(() => {
    let stopped = false, reading = false;
    let timer: number | undefined;
    let cached: CreativeBatch | undefined;
    let terminal = false;
    const alive = () => {
      if (stopped) return false;
      try { if (gateway instanceof HttpCommerceGateway) gateway.assertOwnerCurrent(); } catch { return false; }
      return true;
    };
    aliveRef.current = alive;
    setHistory({ scope });
    const refresh = async () => {
      if (!alive() || reading) return;
      reading = true;
      try {
        let batch: CreativeBatch;
        if (mockMode) {
          const raw: unknown = JSON.parse(sessionStorage.getItem(`zimage:commerce-batches:mock:v2:${ownerKey}`) ?? '[]');
          const found = Array.isArray(raw) ? raw.map(value => creativeBatchSchema.safeParse(value)).find(value => value.success && value.data.id === batchId && value.data.sessionId === sessionId) : undefined;
          if (!found?.success) throw new Error('批量任务不存在或无权访问。');
          batch = found.data;
        } else if (cached) batch = cached;
        else {
          const response = await fetch(`/api/creative-batches/${encodeURIComponent(batchId)}`, { cache: 'no-store' });
          if (!response.ok) throw new Error('批量任务不存在或无权访问。');
          batch = creativeBatchSchema.parse(await response.json());
        }
        if (!alive()) return;
        if (batch.id !== batchId || batch.sessionId !== sessionId) throw new Error('批量任务不存在或无权访问。');
        cached = batch;
        let progress: Progress | undefined;
        let tasks: Record<string, CommerceTask> | undefined;
        if (mockMode && gateway) {
          const loaded = await Promise.all(batch.items.filter(item => item.taskId).map(async item => {
            try {
              const task = await gateway.get(item.taskId!);
              return task.id === item.taskId && task.sessionId === sessionId ? [item.id, task] as const : undefined;
            } catch { return undefined; }
          }));
          tasks = Object.fromEntries(loaded.filter((item): item is readonly [string, CommerceTask] => Boolean(item)));
          progress = { id: batch.id, createdAt: batch.createdAt, updatedAt: batch.updatedAt, terminal: true,
            items: batch.items.map(item => {
              const run = tasks?.[item.id]?.runs.find(value => value.requestId === item.submitRequestId);
              const images = run?.items ?? [];
              return { id: item.id, taskId: item.taskId, status: run ? 'submitted' : item.status,
                total: images.length || item.plan.slots.length, succeeded: images.filter(image => image.status === 'succeeded').length,
                failed: images.filter(image => image.status === 'failed').length, processing: images.filter(image => image.status === 'pending' || image.status === 'processing').length, review: 0 };
            }) };
          terminal = !progress.items.some(item => item.processing > 0);
        } else if (!mockMode) {
          const response = await fetch(`/api/creative-batches/${encodeURIComponent(batchId)}/progress`, { cache: 'no-store' });
          if (!response.ok) throw new Error('批量进度暂时无法读取。');
          progress = progressSchema.parse(await response.json());
          if (progress.id !== batchId || progress.items.some(item => !batch.items.some(original => original.id === item.id))) throw new Error('批量进度暂时无法读取。');
          // A legacy checkpoint can lag a successful submission. The server's
          // read-only projection is authoritative for matching existing runs.
          terminal = !progress.items.some(item => item.processing > 0 || item.status === 'submitted' && item.succeeded + item.failed + item.review < item.total);
        }
        if (alive()) setHistory({ scope, batch, progress, tasks });
      } catch (cause) {
        if (alive()) setHistory(previous => ({ ...(previous.scope === scope ? previous : { scope }), error: cause instanceof Error ? cause.message : '无法读取历史批量任务。' }));
      } finally { reading = false; }
    };
    refreshRef.current = refresh;
    const schedule = () => {
      const delay = cached ? nextPollingDelay(cached.createdAt, 'commerce') : 5000;
      if (!alive() || terminal || delay === null) return;
      timer = window.setTimeout(async () => {
        if (document.visibilityState !== 'hidden') await refresh();
        schedule();
      }, delay);
    };
    void refresh().then(schedule);
    return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [batchId, sessionId, ownerKey, scope, gateway, mockMode]);

  const download = async () => {
    if (!current?.batch) return;
    const alive = aliveRef.current;
    if (!alive()) return;
    const saveBlob = (blob: Blob, filename: string) => {
      if (!alive()) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
    try {
      if (mockMode && gateway) {
        for (const task of Object.values(current.tasks ?? {})) {
          if (!alive()) return;
          if (!task.selections.length) continue;
          const snapshot = await gateway.export(task.id, { requestId: crypto.randomUUID(), revision: task.revision,
            selections: task.slots.flatMap(slot => {
              const selection = task.selections.find(item => item.slotId === slot.id);
              return selection ? [{ slotId: slot.id, generationId: selection.generationId }] : [];
            }) });
          if (!alive()) return;
          if (!snapshot.items.length) throw new Error('history_image_unavailable');
          for (const [index, item] of snapshot.items.entries()) {
            if (!alive()) return;
            if (!item.url || item.expired) throw new Error('history_image_unavailable');
            const response = await fetch(item.url, { credentials: 'omit', signal: AbortSignal.timeout(30_000) });
            if (!alive()) return;
            if (!response.ok) throw new Error('history_image_unavailable');
            const blob = await response.blob();
            const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
            saveBlob(blob, `commerce-${task.id}-${index + 1}.${extension}`);
          }
        }
        return;
      }
      const response = await fetch(`/api/creative-batches/${encodeURIComponent(batchId)}/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format: 'jpg' }) });
      if (!response.ok) throw new Error('历史批量下载失败。');
      const blob = await response.blob();
      saveBlob(blob, `commerce-batch-${batchId}.zip`);
    } catch {
      if (alive()) setHistory(previous => ({ ...previous, error: '历史批量下载失败，请稍后重试。' }));
    }
  };
  const batch = current?.batch, progress = current?.progress;
  const items = batch?.items.map(item => {
    const state = progress?.items.find(value => value.id === item.id);
    return { ...item, ...state, taskId: state?.taskId ?? item.taskId,
      total: state?.total ?? item.plan.slots.length, succeeded: state?.succeeded ?? 0, failed: state?.failed ?? 0, processing: state?.processing ?? 0, review: state?.review ?? 0 };
  });
  const review = items?.reduce((total, item) => total + (item.status === 'needs_review' ? 1 : 0) + item.review, 0) ?? 0;
  return <section className={styles.batchWorkbench} aria-label="历史批量任务"><h2>历史批量任务</h2>
    <p>批量发起已停用。未确认提交的项目已暂停；已提交生成仍由原有队列处理，图片与积分记录保留。</p>
    {current?.error && <p role="alert">{current.error}</p>}
    {!batch ? !current?.error && <p role="status">正在读取历史批量任务…</p> : <>
      <p role="status">已提交 {items!.filter(item => item.status === 'submitted').length}/{items!.length} 个商品任务；失败 {items!.filter(item => item.status === 'failed').length} 个；待核对 {review} 个。</p>
      <ol>{items!.map((item, index) => <li key={item.id}><strong>{index + 1}. {item.plan.brief.name}</strong> · {item.status === 'submitted' ? `图片 ${item.succeeded}/${item.total} 完成${item.failed ? `，失败 ${item.failed} 张` : ''}${item.processing ? `，处理中 ${item.processing} 张` : ''}${item.review ? `，${item.review} 待核对` : ''}` : item.status === 'needs_review' ? '提交状态待核对，请查看历史任务。' : item.status === 'failed' ? '提交失败' : item.status === 'created' ? '提交尚未确认，批量发起已停用，项目已暂停；以历史任务记录为准。' : '尚未提交，批量发起已停用，项目已暂停。'}
        {item.error && <span role="alert"> · {item.error}</span>}
        {item.taskId && <a href={sessionHref(sessionId, item.taskId, 'results')}>查看历史任务</a>}
      </li>)}</ol>
      <button disabled={mockMode ? !Object.values(current.tasks ?? {}).some(task => task.selections.length) : !progress?.items.some(item => item.succeeded > 0)} onClick={() => void download()}>{mockMode ? '下载已完成商品图片' : '下载已完成商品 ZIP'}</button>
    </>}
    <button type="button" onClick={() => void refreshRef.current()}>手动刷新进度</button>
  </section>;
}
