import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageRequest } from '@zimage/domain';
import { waitFor } from '@testing-library/react';
import { HttpWorkspaceGateway } from '../../web/gateways/http-workspace-gateway';
import { normalizeReferenceUploadFile } from '../../web/gateways/reference-upload-file';

vi.mock('../../web/gateways/reference-upload-file', () => ({ normalizeReferenceUploadFile: vi.fn(async file => file) }));
const sessionId = '10000000-0000-4000-8000-0000000000a1';
const referenceId = '40000000-0000-4000-8000-0000000000a1';
const file = new File(['fixture'], 'reference.png', { type: 'image/png' });
const request: ImageRequest = { sessionId, prompt: 'owner A private image prompt', aspectRatio: '1:1', resolution: '2K', count: 1,
  references: [{ file, name: file.name, mimeType: file.type, size: file.size }] };
beforeEach(() => { window.sessionStorage.clear(); vi.mocked(normalizeReferenceUploadFile).mockImplementation(async file => file); });
afterEach(() => vi.restoreAllMocks());
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('HTTP context belongs permanently to the initiating owner and mount', () => {
  it('blocks upload-to-image continuation after owner reset even if fetch ignores abort', async () => {
    const upload = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>(async path => path === '/api/uploads' ? upload.promise : Response.json({ sessions: [] }));
    const base = new HttpWorkspaceGateway({ fetcher });
    const a = base.createOwnerScope(() => true);
    const result = a.gateway.submitImage(request);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/uploads', expect.anything()));
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    base.clearAssetCaches();
    const b = base.createOwnerScope(() => true);
    upload.resolve(Response.json({ id: referenceId, name: 'reference.png', mimeType: 'image/png', size: file.size,
      width: 64, height: 48, expiresAt: '2026-11-01T00:00:00Z' }));
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(a.isCurrent()).toBe(false);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/uploads']);
    await expect(b.gateway.listSessions()).resolves.toEqual([]);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/uploads', '/api/sessions']);
    a.dispose(); b.dispose();
  });
  it('blocks a delayed local decode before the first upload and before creating billing recovery state', async () => {
    const decoded = deferred<File>();
    vi.mocked(normalizeReferenceUploadFile).mockReturnValueOnce(decoded.promise);
    const fetcher = vi.fn<typeof fetch>();
    let active = true;
    const scope = new HttpWorkspaceGateway({ fetcher }).createOwnerScope(() => active);
    const result = scope.gateway.submitImage({ ...request, billing: { version: 'fixture', totalMinor: 2 } });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    active = false;
    decoded.resolve(file);
    await rejected;
    expect(fetcher).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('zimage:pending-credit-requests:v1')).toBeNull();
    scope.dispose();
  });
  it('discards a delayed response body without erasing another owner recovery request', async () => {
    const body = deferred<unknown>();
    const response = Response.json({});
    vi.spyOn(response, 'json').mockReturnValue(body.promise);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const base = new HttpWorkspaceGateway({ fetcher });
    const a = base.createOwnerScope(() => true);
    const result = a.gateway.submitImage({ ...request, references: [], billing: { version: 'fixture', totalMinor: 2 } });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(response.json).toHaveBeenCalled());
    base.clearAssetCaches();
    const bRecord = '[{"identity":"B outstanding request","body":"private B body","requestId":"B original ID"}]';
    window.sessionStorage.setItem('zimage:pending-credit-requests:v1', bRecord);
    body.resolve({ batchId: '30000000-0000-4000-8000-0000000000a1', sessionId, status: 'pending' });
    await rejected;
    expect(window.sessionStorage.getItem('zimage:pending-credit-requests:v1')).toBe(bRecord);
    expect(fetcher).toHaveBeenCalledOnce();
    a.dispose();
  });
  it('blocks stale commerce/apparel calls through the same scoped transport', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const base = new HttpWorkspaceGateway({ fetcher });
    let active = true;
    const scope = base.createOwnerScope(() => active);
    active = false;
    await expect(scope.gateway.commerce.create({} as Parameters<typeof scope.gateway.commerce.create>[0])).rejects.toMatchObject({ name: 'AbortError' });
    await expect(scope.gateway.commerce.apparel.list(sessionId)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
    scope.dispose();
  });
  it.each([200, 409])('does not settle another owner billing recovery from a late optimize body (HTTP %s)', async status => {
    const body = deferred<unknown>();
    const response = Response.json({}, { status });
    vi.spyOn(response, 'json').mockReturnValue(body.promise);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const base = new HttpWorkspaceGateway({ fetcher });
    const scope = base.createOwnerScope(() => true);
    const result = scope.gateway.optimizeText({ field: 'title', text: 'same private prompt', billing: { version: 'fixture', totalMinor: 2 } });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(response.json).toHaveBeenCalled());
    const records = JSON.parse(window.sessionStorage.getItem('zimage:pending-credit-requests:v1')!);
    base.clearAssetCaches();
    const bRecord = JSON.stringify(records.map((record: object) => ({ ...record, requestId: 'owner-B-original-request', body: 'owner-B-unknown-billing' })));
    window.sessionStorage.setItem('zimage:pending-credit-requests:v1', bRecord);
    body.resolve(status === 200 ? { text: 'late optimized result', mock: false } : { code: 'price_changed', message: 'changed', retryable: false });
    await rejected;
    expect(window.sessionStorage.getItem('zimage:pending-credit-requests:v1')).toBe(bRecord);
    expect(fetcher).toHaveBeenCalledOnce();
    scope.dispose();
  });
  it.each(['commerce', 'apparel'] as const)('rejects a late %s download blob after owner invalidation', async kind => {
    const body = deferred<Blob>();
    const response = new Response('fixture');
    vi.spyOn(response, 'blob').mockReturnValue(body.promise);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const base = new HttpWorkspaceGateway({ fetcher });
    const scope = base.createOwnerScope(() => true);
    const result = kind === 'commerce' ? scope.gateway.commerce.downloadFile('task-fixture', {})
      : scope.gateway.commerce.apparel.download('task-fixture', {} as Parameters<typeof scope.gateway.commerce.apparel.download>[1]);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(response.blob).toHaveBeenCalled());
    base.clearAssetCaches();
    body.resolve(new Blob(['private owner A bytes']));
    await rejected;
    expect(fetcher).toHaveBeenCalledOnce();
    scope.dispose();
  });

});
