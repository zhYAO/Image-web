import { render, screen } from '@testing-library/react';
import { buildCommerceSlots, IMAGE_PROVIDER_CAPABILITIES } from '@zimage/domain';
import { afterEach, expect, it, vi } from 'vitest';
import { CommerceBatchWizard } from '@/features/commerce/CommerceBatchWizard';
import { createTestGateway } from './workspace-test-fixtures';

afterEach(() => vi.unstubAllGlobals());

it('reads twenty child counts with one progress request and no child GET or browser POST', async () => {
  const sessionId = crypto.randomUUID(), batchId = crypto.randomUUID();
  const settings = { provider: 'gemini', model: 'gemini-3-pro-image', aspectRatio: '1:1' as const, resolution: '2K' as const };
  const brief = { name: '测试商品', facts: '', sellingPoints: '', platform: 'taobao' as const,
    placement: '商品展示', productReferenceIds: [crypto.randomUUID()], styleReferenceIds: [] };
  const plan = { scene: 'product-set' as const, brief, templateId: 'soft-studio',
    slots: buildCommerceSlots(brief, 'product-set', 1, settings) };
  const items = Array.from({ length: 20 }, () => ({ id: crypto.randomUUID(),
    createRequestId: crypto.randomUUID(), submitRequestId: crypto.randomUUID(),
    taskId: crypto.randomUUID(), plan, overrides: {}, status: 'submitted' }));
  const createdAt = new Date().toISOString();
  const batch = { id: batchId, sessionId, requestId: crypto.randomUUID(), workflow: 'product-set',
    globalParams: {}, items, createdAt, updatedAt: createdAt };
  const progress = { id: batchId, createdAt, updatedAt: createdAt, terminal: true,
    items: items.map((item, index) => ({ id: item.id, taskId: item.taskId, status: 'submitted',
      total: 1, succeeded: index === 0 ? 0 : 1, failed: 0, processing: 0,
      review: index === 0 ? 1 : 0 })) };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') throw new Error('unexpected browser advance');
    return Response.json(url.endsWith('/progress') ? progress : batch);
  });
  vi.stubGlobal('fetch', fetcher);
  const gateway = createTestGateway().commerce;
  const get = vi.spyOn(gateway, 'get');
  render(<CommerceBatchWizard ownerKey="owner" batchId={batchId} sessionId={sessionId}
    gateway={gateway} settings={settings} capabilities={IMAGE_PROVIDER_CAPABILITIES} />);
  await screen.findByText(/已提交 20\/20 个商品任务/);
  expect(screen.getByText(/待核对 1 个/)).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(get).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it('clears a transient progress error after the next successful read', async () => {
  const sessionId = crypto.randomUUID(), batchId = crypto.randomUUID(), taskId = crypto.randomUUID();
  const settings = { provider: 'gemini', model: 'gemini-3-pro-image', aspectRatio: '1:1' as const, resolution: '2K' as const };
  const brief = { name: '测试商品', facts: '', sellingPoints: '', platform: 'taobao' as const,
    placement: '商品展示', productReferenceIds: [crypto.randomUUID()], styleReferenceIds: [] };
  const plan = { scene: 'product-set' as const, brief, templateId: 'soft-studio',
    slots: buildCommerceSlots(brief, 'product-set', 1, settings) };
  const item = { id: crypto.randomUUID(), createRequestId: crypto.randomUUID(),
    submitRequestId: crypto.randomUUID(), taskId, plan, overrides: {}, status: 'submitted' };
  const createdAt = new Date().toISOString();
  const batch = { id: batchId, sessionId, requestId: crypto.randomUUID(), workflow: 'product-set',
    globalParams: {}, items: [item], createdAt, updatedAt: createdAt };
  const progress = { id: batchId, createdAt, updatedAt: createdAt, terminal: true,
    items: [{ id: item.id, taskId, status: 'submitted', total: 1, succeeded: 1, failed: 0, processing: 0, review: 0 }] };
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!url.endsWith('/progress')) return Response.json(batch);
    return ++reads === 1 ? Response.json({ error: 'unavailable' }, { status: 503 }) : Response.json(progress);
  }));
  render(<CommerceBatchWizard ownerKey="owner" batchId={batchId} sessionId={sessionId}
    gateway={createTestGateway().commerce} settings={settings} capabilities={IMAGE_PROVIDER_CAPABILITIES} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('批量进度暂时无法读取。');
  expect(await screen.findByText(/已提交 1\/1 个商品任务/, {}, { timeout: 7000 })).toBeTruthy();
  expect(screen.queryByText('批量进度暂时无法读取。')).toBeNull();
});
