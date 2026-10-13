import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationBatch } from '@zimage/domain';
import { WorkspaceTimeline } from '@/features/workspace/WorkspaceTimeline';
import { HttpWorkspaceGateway } from '@/gateways/http-workspace-gateway';

const generationId = '40000000-0000-4000-8000-000000000001';
const observers: Array<{ target?: Element; callback: IntersectionObserverCallback; disconnected: boolean }> = [];
let visibility: DocumentVisibilityState;
beforeEach(() => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  class Observer {
    entry = { target: undefined as Element | undefined, callback: (() => {}) as IntersectionObserverCallback, disconnected: false };
    constructor(callback: IntersectionObserverCallback) { this.entry.callback = callback; observers.push(this.entry); }
    observe(target: Element) { this.entry.target = target; }
    disconnect() { this.entry.disconnected = true; }
  }
  vi.stubGlobal('IntersectionObserver', Observer);
});
afterEach(() => { observers.length = 0; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function batch(status: 'processing' | 'succeeded' = 'succeeded'): GenerationBatch {
  return { id: '40000000-0000-4000-8000-000000000002', sessionId: '40000000-0000-4000-8000-000000000003',
    createdAt: new Date().toISOString(), source: 'direct', provider: 'seedream', model: 'doubao-seedream-5.0-pro',
    prompt: '本地合成预览', status, config: { aspectRatio: '1:1', resolution: '2K', count: 1 }, assets: [{ id: generationId, status }] };
}
function view(resolve: (id: string, refresh?: boolean) => Promise<string | undefined>, status: 'processing' | 'succeeded' = 'succeeded', scope = 'account-a:session-a') {
  const value = batch(status);
  return <WorkspaceTimeline key={scope} items={[{ id: 'turn', type: 'generation', sequence: 1, batch: value, createdAt: value.createdAt, sessionId: value.sessionId }]}
    streamingText="" resolveAssetUrl={resolve} onDownloadBatch={vi.fn()} onRecreate={vi.fn()} />;
}
async function intersect(visible: boolean, index = observers.length - 1) {
  const observer = observers[index]!;
  await act(async () => observer.callback([{ target: observer.target, isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver));
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function tab(next: DocumentVisibilityState) { visibility = next; await act(async () => document.dispatchEvent(new Event('visibilitychange'))); }

describe('workspace result preview lifecycle', () => {
  it('observes the reserved image frame when a result first completes, even if its top edge is clipped', async () => {
    const resolve = vi.fn(async () => '/synthetic.png');
    const component = render(view(resolve, 'processing'));
    expect(observers).toHaveLength(0);
    component.rerender(view(resolve));
    expect(observers[0]?.target).toHaveStyle({ aspectRatio: '1 / 1' });
    expect(resolve).not.toHaveBeenCalled();
    await intersect(true);
    expect(await screen.findByAltText('生成结果 1')).toHaveAttribute('src', '/synthetic.png');
  });
  it('does not load a hidden frame and retains its loaded preview when scrolling away and back', async () => {
    const resolve = vi.fn(async () => '/synthetic.png');
    render(view(resolve));
    await intersect(false); expect(resolve).not.toHaveBeenCalled();
    await intersect(true); await screen.findByAltText('生成结果 1');
    await intersect(false); await intersect(true);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it('ignores a pending result after leaving view and reuses the gateway cache on return', async () => {
    const request = deferred<Response>(); const fetcher = vi.fn(() => request.promise);
    const gateway = new HttpWorkspaceGateway({ fetcher: fetcher as typeof fetch });
    render(view(gateway.getGenerationAssetUrl.bind(gateway)));
    await intersect(true); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await intersect(false);
    await act(async () => request.resolve(new Response(JSON.stringify({ generationId, url: 'https://example.invalid/synthetic.png', expiresAt: new Date(Date.now() + 120000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } })));
    expect(screen.queryByAltText('生成结果 1')).not.toBeInTheDocument();
    await intersect(true); await screen.findByAltText('生成结果 1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['account-b:session-a', 'account-a:session-b'])('cancels stale preview work when switching scope to %s', async scope => {
    const old = deferred<string>(); const next = vi.fn(async () => '/next-owner.png');
    const component = render(view(() => old.promise)); await intersect(true);
    component.rerender(view(next, 'succeeded', scope));
    await act(async () => old.resolve('/old-owner.png'));
    expect(screen.queryByAltText('生成结果 1')).not.toBeInTheDocument();
    await intersect(true); expect(await screen.findByAltText('生成结果 1')).toHaveAttribute('src', '/next-owner.png');
  });
  it('drops an old resolver ownership scope and waits for a fresh visibility observation', async () => {
    const first = vi.fn(async () => '/first-owner.png');
    const next = vi.fn(async () => '/next-owner.png');
    const component = render(view(first)); await intersect(true); await screen.findByAltText('生成结果 1');
    component.rerender(view(next));
    expect(screen.queryByAltText('生成结果 1')).not.toBeInTheDocument();
    expect(next).not.toHaveBeenCalled();
    await intersect(true); expect(await screen.findByAltText('生成结果 1')).toHaveAttribute('src', '/next-owner.png');
  });
  it('shows a preview-only retry after URL lookup fails without buying another generation', async () => {
    const resolve = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue('/retry.png');
    render(view(resolve)); await intersect(true);
    fireEvent.click(await screen.findByRole('button', { name: '重试图片预览' }));
    expect(await screen.findByAltText('生成结果 1')).toHaveAttribute('src', '/retry.png');
    expect(resolve).toHaveBeenLastCalledWith(generationId, true);
  });
  it('does not start in a hidden tab, cancels pending mounting while hidden and resumes from the gateway cache', async () => {
    visibility = 'hidden';
    const request = deferred<Response>(); const fetcher = vi.fn(() => request.promise);
    const gateway = new HttpWorkspaceGateway({ fetcher: fetcher as typeof fetch });
    render(view(gateway.getGenerationAssetUrl.bind(gateway))); await intersect(true);
    expect(fetcher).not.toHaveBeenCalled();
    await tab('visible'); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await tab('hidden');
    await act(async () => request.resolve(new Response(JSON.stringify({ generationId, url: 'https://example.invalid/resumed.png', expiresAt: new Date(Date.now() + 120000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } })));
    expect(screen.queryByAltText('生成结果 1')).not.toBeInTheDocument();
    await tab('visible'); expect(await screen.findByAltText('生成结果 1')).toHaveAttribute('src', 'https://example.invalid/resumed.png');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('allows at most one automatic signed-URL refresh for repeated image errors', async () => {
    const resolve = vi.fn().mockResolvedValueOnce('/initial.png').mockResolvedValue('/refreshed.png');
    render(view(resolve)); await intersect(true);
    const image = await screen.findByAltText('生成结果 1');
    fireEvent.error(image); fireEvent.error(image);
    await waitFor(() => expect(screen.getByAltText('生成结果 1')).toHaveAttribute('src', '/refreshed.png'));
    fireEvent.error(screen.getByAltText('生成结果 1'));
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
