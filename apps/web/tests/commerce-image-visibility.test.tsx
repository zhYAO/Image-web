import { act, fireEvent, render, screen } from '@testing-library/react';
import { buildCommerceSlots, IMAGE_PROVIDER_CAPABILITIES, type CommerceTask } from '@zimage/domain';
import { afterEach, expect, it, vi } from 'vitest';
import { CommerceTaskCard } from '@/features/commerce/CommerceTaskCard';
import { createTestGateway } from './workspace-test-fixtures';

afterEach(() => vi.unstubAllGlobals());

it('does not sign a hidden result and signs it only when its result enters the viewport', async () => {
  let onIntersect!: IntersectionObserverCallback;
  class Observer {
    constructor(callback: IntersectionObserverCallback) { onIntersect = callback; }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  const brief = { name: '杯子', facts: '', sellingPoints: '', platform: 'taobao' as const,
    placement: '商品展示', productReferenceIds: [crypto.randomUUID()], styleReferenceIds: [] };
  const slots = buildCommerceSlots(brief, 'product-set', 1, { provider: 'gemini',
    model: 'gemini-3-pro-image', aspectRatio: '1:1', resolution: '2K' });
  const generationId = crypto.randomUUID();
  const task: CommerceTask = { id: crypto.randomUUID(), sessionId: crypto.randomUUID(),
    scene: 'product-set', brief, templateId: 'soft-studio', slots, revision: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false,
    slotHashes: {}, selections: [{ slotId: slots[0]!.id, generationId, compatibilityHash: 'hash', version: 0 }],
    runs: [{ id: crypto.randomUUID(), requestId: crypto.randomUUID(), revision: 1,
      createdAt: new Date().toISOString(), items: [{ slotId: slots[0]!.id, batchId: crypto.randomUUID(),
        generationId, status: 'succeeded', compatibilityHash: 'hash', selectionVersion: 0 }] }] };
  const gateway = createTestGateway().commerce;
  const assetUrl = vi.fn(async () => ({ url: 'https://example.invalid/result.jpg', expired: false }));
  Object.assign(gateway, { assetUrl });
  const props = { task, gateway, capabilities: IMAGE_PROVIDER_CAPABILITIES, onTask: vi.fn() };
  const view = render(<CommerceTaskCard {...props} active={false} />);
  await act(async () => { await Promise.resolve(); });
  expect(assetUrl).not.toHaveBeenCalled();
  view.rerender(<CommerceTaskCard {...props} active />);
  await act(async () => { await Promise.resolve(); });
  expect(assetUrl).not.toHaveBeenCalled();
  await act(async () => { onIntersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
  expect(assetUrl).toHaveBeenCalledTimes(1);
  const image = screen.getByAltText('杯子 第 1 张当前选图');
  await act(async () => { fireEvent.error(image); fireEvent.error(image); await Promise.resolve(); });
  expect(assetUrl).toHaveBeenCalledTimes(2);
});

it('signs only the reference belonging to a visible clone result', async () => {
  const observers: Array<{ target?: Element; callback: IntersectionObserverCallback }> = [];
  class Observer {
    private entry: { target?: Element; callback: IntersectionObserverCallback };
    constructor(callback: IntersectionObserverCallback) { this.entry = { callback }; observers.push(this.entry); }
    observe(target: Element) { this.entry.target = target; }
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  const referenceIds = [crypto.randomUUID(), crypto.randomUUID()];
  const brief = { name: '杯子', facts: '', sellingPoints: '', platform: 'taobao' as const,
    placement: '商品展示', productReferenceIds: [], styleReferenceIds: referenceIds };
  const slots = buildCommerceSlots(brief, 'clone', 2, { provider: 'gemini',
    model: 'gemini-3-pro-image', aspectRatio: '1:1', resolution: '2K' });
  const generations = [crypto.randomUUID(), crypto.randomUUID()];
  const task: CommerceTask = { id: crypto.randomUUID(), sessionId: crypto.randomUUID(),
    scene: 'clone', brief, templateId: 'soft-studio', slots, revision: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), archived: false,
    slotHashes: {}, selections: slots.map((slot, index) => ({ slotId: slot.id,
      generationId: generations[index]!, compatibilityHash: 'hash', version: 0 })),
    runs: [{ id: crypto.randomUUID(), requestId: crypto.randomUUID(), revision: 1,
      createdAt: new Date().toISOString(), items: slots.map((slot, index) => ({ slotId: slot.id,
        batchId: crypto.randomUUID(), generationId: generations[index]!, status: 'succeeded',
        compatibilityHash: 'hash', selectionVersion: 0 })) }] };
  const gateway = createTestGateway().commerce;
  Object.assign(gateway, { assetUrl: vi.fn(async () => ({ url: 'https://example.invalid/result.jpg', expired: false })) });
  const fetcher = vi.fn(async (url: string) => {
    expect(url).toContain('/api/references/');
    return { ok: true, json: async () => ({ url: 'https://example.invalid/reference.jpg' }) };
  });
  vi.stubGlobal('fetch', fetcher);
  render(<CommerceTaskCard task={task} gateway={gateway} capabilities={IMAGE_PROVIDER_CAPABILITIES}
    onTask={vi.fn()} active />);
  const first = observers.find(observer => observer.target?.textContent?.includes('第 1 张'));
  expect(first).toBeDefined();
  await act(async () => {
    first!.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await Promise.resolve();
  });
  const signatures = fetcher.mock.calls.map(([path]) => path).filter(path => path.startsWith('/api/references/'));
  expect(signatures).toEqual([expect.stringContaining(referenceIds[0]!)]);
});
