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
    items: items.map(item => ({ id: item.id, taskId: item.taskId, status: 'submitted',
      total: 1, succeeded: 1, failed: 0, processing: 0 })) };
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
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(get).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
