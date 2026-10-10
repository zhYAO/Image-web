import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildCommerceSlots, commerceTaskSchema, IMAGE_PROVIDER_CAPABILITIES, type CreativeBatch } from '@zimage/domain';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LegacyCreativeBatchHistory } from '@/features/commerce/LegacyCreativeBatchHistory';
import { CommerceWorkspace } from '@/features/commerce/CommerceWorkspace';
import { createTestGateway } from './workspace-test-fixtures';

const settings = { provider: 'gemini', model: 'gemini-3-pro-image', aspectRatio: '1:1' as const, resolution: '2K' as const };
function fixture(sessionId = crypto.randomUUID()): CreativeBatch {
  const brief = { name: '历史陶瓷杯', facts: '', sellingPoints: '', platform: 'taobao' as const, placement: '商品展示', productReferenceIds: [crypto.randomUUID()], styleReferenceIds: [] };
  const plan = { scene: 'product-set' as const, brief, templateId: 'soft-studio', slots: buildCommerceSlots(brief, 'product-set', 1, settings) };
  const createdAt = new Date().toISOString();
  return { id: crypto.randomUUID(), sessionId, requestId: crypto.randomUUID(), workflow: 'product-set', globalParams: {}, createdAt, updatedAt: createdAt,
    items: ['pending', 'created', 'submitted', 'needs_review'].map((status, index) => ({ id: crypto.randomUUID(), createRequestId: crypto.randomUUID(), submitRequestId: crypto.randomUUID(), taskId: index ? crypto.randomUUID() : undefined, plan, overrides: {}, status: status as CreativeBatch['items'][number]['status'] })) };
}
const progress = (batch: CreativeBatch) => ({ id: batch.id, createdAt: batch.createdAt, updatedAt: batch.updatedAt, terminal: true,
  items: batch.items.map(item => ({ id: item.id, taskId: item.taskId, status: item.status, total: 1, succeeded: item.status === 'submitted' ? 1 : 0, failed: 0, processing: 0, review: 0 })) });
const props = (batch: CreativeBatch) => ({ ownerKey: 'owner-A', sessionId: batch.sessionId, batchId: batch.id, gateway: createTestGateway().commerce, settings, capabilities: IMAGE_PROVIDER_CAPABILITIES });
beforeEach(() => { sessionStorage.clear(); vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'http'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('renders only legacy progress and existing child task addresses, with explicit retired submission status', async () => {
  const batch = fixture(), input = props(batch);
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') throw new Error('history cannot submit');
    return Response.json(url.endsWith('/progress') ? progress(batch) : batch);
  });
  vi.stubGlobal('fetch', fetcher);
  const create = vi.spyOn(input.gateway, 'create'), submit = vi.spyOn(input.gateway, 'submit');
  render(<LegacyCreativeBatchHistory {...input} />);
  expect(await screen.findByRole('heading', { name: '历史批量任务' })).toBeVisible();
  expect(screen.getAllByText(/批量发起已停用/).length).toBeGreaterThan(0);
  expect(screen.getByText(/已提交生成仍由原有队列处理/)).toBeVisible();
  expect(screen.getAllByRole('link', { name: '查看历史任务' })).toHaveLength(3);
  expect(screen.getAllByRole('link', { name: '查看历史任务' })[0]).toHaveAttribute('href', `/sessions/${batch.sessionId}?task=${batch.items[1]!.taskId}&view=results`);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  expect(create).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /确认提交|核对.*费用/ })).toBeNull();
});

it('refuses an existing batch from a different session before reading child progress', async () => {
  const batch = fixture(), input = props(batch);
  const fetcher = vi.fn(async () => Response.json(batch)); vi.stubGlobal('fetch', fetcher);
  render(<LegacyCreativeBatchHistory {...input} sessionId={crypto.randomUUID()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('批量任务不存在或无权访问。');
  expect(screen.queryByText('历史陶瓷杯')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('hides loaded history immediately on owner change and ignores the old late response', async () => {
  const batch = fixture(), input = props(batch);
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(async () => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
  const view = render(<LegacyCreativeBatchHistory {...input} />);
  await waitFor(() => expect(finish).toBeDefined()); const oldFinish = finish;
  view.rerender(<LegacyCreativeBatchHistory {...input} ownerKey="owner-B" />);
  await act(async () => { oldFinish(Response.json(batch)); });
  expect(screen.queryByText(/历史陶瓷杯/)).toBeNull();
  expect(screen.queryByRole('link', { name: '查看历史任务' })).toBeNull();
});

it('keeps historical ZIP export available without advancing generation', async () => {
  const batch = fixture();
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/download') && init?.method === 'POST' ? new Response('zip') : Response.json(url.endsWith('/progress') ? progress(batch) : batch));
  vi.stubGlobal('fetch', fetcher); vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:history'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  render(<LegacyCreativeBatchHistory {...props(batch)} />);
  fireEvent.click(await screen.findByRole('button', { name: '下载已完成商品 ZIP' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/download'))).toBe(true));
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => url)).toEqual([`/api/creative-batches/${batch.id}/download`]);
});

it.each(['fetch', 'blob'])('shows a retryable Chinese message for a historical ZIP %s disconnect', async boundary => {
  const batch = fixture();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/download')) {
      if (boundary === 'fetch') throw new TypeError('fetch failed: low-level socket detail');
      const response = new Response('zip');
      vi.spyOn(response, 'blob').mockRejectedValue(new TypeError('terminated: body stream detail'));
      return response;
    }
    return Response.json(url.endsWith('/progress') ? progress(batch) : batch);
  }));
  render(<LegacyCreativeBatchHistory {...props(batch)} />);
  fireEvent.click(await screen.findByRole('button', { name: '下载已完成商品 ZIP' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('历史批量下载失败，请稍后重试。');
  expect(screen.queryByText(/low-level socket|body stream/)).toBeNull();
});

it('reads owner-scoped mock history without creating, submitting or rewriting pending items', async () => {
  vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'mock');
  vi.resetModules();
  const { LegacyCreativeBatchHistory: MockHistory } = await import('@/features/commerce/LegacyCreativeBatchHistory');
  const batch = fixture(), input = props(batch);
  const key = 'zimage:commerce-batches:mock:v2:owner-A', raw = JSON.stringify([batch]);
  sessionStorage.setItem(key, raw);
  const create = vi.spyOn(input.gateway, 'create'), submit = vi.spyOn(input.gateway, 'submit');
  const fetcher = vi.fn(() => { throw new Error('mock history must not use HTTP'); }); vi.stubGlobal('fetch', fetcher);
  const view = render(<MockHistory {...input} />);
  expect(await screen.findByRole('heading', { name: '历史批量任务' })).toBeVisible();
  expect(create).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(key)).toBe(raw); expect(fetcher).not.toHaveBeenCalled();
  view.rerender(<MockHistory {...input} ownerKey="owner-B" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('批量任务不存在或无权访问。');
  expect(screen.queryByText(/历史陶瓷杯/)).toBeNull();
});

function mockDownloadFixture() {
  const batch = fixture(); batch.items = [batch.items[2]!];
  const item = batch.items[0]!, slot = item.plan.slots[0]!, generationId = crypto.randomUUID();
  const task = commerceTaskSchema.parse({ ...item.plan, id: item.taskId, sessionId: batch.sessionId, revision: 1,
    createdAt: batch.createdAt, updatedAt: batch.updatedAt, runs: [{ id: crypto.randomUUID(), requestId: item.submitRequestId, revision: 1, createdAt: batch.createdAt,
      items: [{ slotId: slot.id, generationId, batchId: crypto.randomUUID(), status: 'succeeded', url: 'data:image/png;base64,eA==', compatibilityHash: 'hash', selectionVersion: 1 }] }],
    selections: [{ slotId: slot.id, generationId, compatibilityHash: 'hash', version: 1 }] });
  const input = props(batch); vi.spyOn(input.gateway, 'get').mockResolvedValue(task);
  sessionStorage.setItem('zimage:commerce-batches:mock:v2:owner-A', JSON.stringify([batch]));
  const exported = { id: crypto.randomUUID(), revision: 1, createdAt: batch.createdAt, items: [{ slotId: slot.id, generationId, url: 'data:image/png;base64,eA==' }] };
  return { batch, input, exported };
}

it('cancels mock history downloading when the owner changes before export returns', async () => {
  vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'mock');
  const { input, exported } = mockDownloadFixture();
  let finish!: (value: typeof exported) => void;
  vi.spyOn(input.gateway, 'export').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const fetcher = vi.fn(async () => new Response('image')); vi.stubGlobal('fetch', fetcher);
  const view = render(<LegacyCreativeBatchHistory {...input} />);
  fireEvent.click(await screen.findByRole('button', { name: '下载已完成商品图片' }));
  await waitFor(() => expect(finish).toBeDefined());
  view.rerender(<LegacyCreativeBatchHistory {...input} ownerKey="owner-B" />);
  await act(async () => finish(exported));
  expect(fetcher).not.toHaveBeenCalled();
});

it('reports a mock history image transport failure instead of silently claiming a download', async () => {
  vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'mock');
  const { input, exported } = mockDownloadFixture();
  vi.spyOn(input.gateway, 'export').mockResolvedValue(exported);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('socket lost'); }));
  render(<LegacyCreativeBatchHistory {...input} />);
  fireEvent.click(await screen.findByRole('button', { name: '下载已完成商品图片' }));
  expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent('历史批量下载失败，请稍后重试。');
});

it('downloads a mock historical image only after reading the complete exported blob', async () => {
  vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'mock');
  const { input, exported } = mockDownloadFixture();
  vi.spyOn(input.gateway, 'export').mockResolvedValue(exported);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('image', { headers: { 'content-type': 'image/png' } })));
  const createObjectURL = vi.fn(() => 'blob:history');
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  render(<LegacyCreativeBatchHistory {...input} />);
  fireEvent.click(await screen.findByRole('button', { name: '下载已完成商品图片' }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('uses the read-only progress projection when a created checkpoint already has a submitted run', async () => {
  const batch = fixture(); batch.items = [batch.items[1]!];
  const projected = progress(batch); projected.items[0]!.status = 'submitted'; projected.items[0]!.processing = 1; projected.terminal = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/progress') ? projected : batch)));
  render(<LegacyCreativeBatchHistory {...props(batch)} />);
  expect(await screen.findByText(/已提交 1\/1 个商品任务/)).toBeVisible();
  expect(screen.queryByText(/提交尚未确认，批量发起/)).toBeNull();
  expect(screen.getByText('图片 0/1 完成', { exact: false })).toBeVisible();
});

it('clears loaded history when changing sessions, and ignores a late old-session progress response', async () => {
  const batch = fixture(), input = props(batch);
  let finish!: (response: Response) => void;
  let progressReads = 0;
  const fetcher = vi.fn(async (url: string) => !url.endsWith('/progress') ? Response.json(batch) : ++progressReads === 1 ? Response.json(progress(batch)) : new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<LegacyCreativeBatchHistory {...input} />);
  await screen.findByText(/已提交 1\/4 个商品任务/);
  fireEvent.click(screen.getByRole('button', { name: '手动刷新进度' }));
  await waitFor(() => expect(finish).toBeDefined());
  view.rerender(<LegacyCreativeBatchHistory {...input} sessionId={crypto.randomUUID()} />);
  expect(screen.queryByRole('link', { name: '查看历史任务' })).toBeNull();
  await act(async () => finish(Response.json(progress(batch))));
  expect(await screen.findByRole('alert')).toHaveTextContent('批量任务不存在或无权访问。');
  expect(screen.queryByText(/历史陶瓷杯/)).toBeNull();
});

it('keeps an existing single-task draft hidden while viewing the same session batch history', async () => {
  const batch = fixture(), gateway = createTestGateway().commerce;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/progress') ? progress(batch) : batch)));
  const input = { ref: null, ownerKey: 'owner-A', gateway, sessionId: batch.sessionId, items: [], references: [], capabilities: IMAGE_PROVIDER_CAPABILITIES, settings,
    launch: { scene: 'product-set' as const, sessionId: batch.sessionId }, onReferenceAdd: vi.fn(), onReferenceRemove: vi.fn(), onReferenceUploaded: vi.fn(), onReferencesAdopt: () => true, renderTimeline: () => null };
  const view = render(<CommerceWorkspace {...input} />);
  await screen.findByRole('textbox', { name: '商品描述' });
  view.rerender(<CommerceWorkspace {...input} requestedBatchId={batch.id} />);
  expect(await screen.findByRole('heading', { name: '历史批量任务' })).toBeVisible();
  expect(screen.queryByRole('textbox', { name: '商品描述' })).toBeNull();
  expect(screen.queryByRole('button', { name: '保存草稿' })).toBeNull();
});


it('distinguishes failed submitted images from failed submissions in historical progress', async () => {
  const batch = fixture(); batch.items = [batch.items[2]!];
  const failed = progress(batch); failed.items[0]!.succeeded = 0; failed.items[0]!.failed = 1;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/progress') ? failed : batch)));
  render(<LegacyCreativeBatchHistory {...props(batch)} />);
  expect(await screen.findByText(/图片 0\/1 完成/)).toHaveTextContent('失败 1 张');
  expect(screen.getByRole('status')).toHaveTextContent('失败 0 个');
  expect(screen.queryByText(/尚未提交/)).toBeNull();
});
