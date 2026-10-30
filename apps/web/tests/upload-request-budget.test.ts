import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import { MAX_UPLOAD_BODY_BYTES, MAX_UPLOAD_FILE_BYTES, getUploadBudgetState, withUploadRequestBudget } from '@/server/assets/upload-request-budget';
import { getDrainState } from '@/server/lifecycle/request-lifecycle';

beforeEach(() => vi.stubGlobal('File', NodeFile));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
function streamed(body: ReadableStream<Uint8Array>, length?: string, signal?: AbortSignal) {
  const request = new Request('http://app.test/api/uploads', { method: 'POST', body, duplex: 'half',
    headers: { 'content-type': 'multipart/form-data; boundary=test', ...(length === undefined ? {} : { 'content-length': length }) } } as RequestInit);
  if (signal) Object.defineProperty(request, 'signal', { value: signal });
  return request;
}

it('accepts a complete legal 10 MiB file plus multipart fields before byte conversion', async () => {
  const prefix = new TextEncoder().encode(`--test\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\n${crypto.randomUUID()}\r\n--test\r\nContent-Disposition: form-data; name="file"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n`);
  const suffix = new TextEncoder().encode('\r\n--test--\r\n');
  const request = streamed(new ReadableStream({ start(c) { c.enqueue(prefix); c.enqueue(new Uint8Array(MAX_UPLOAD_FILE_BYTES)); c.enqueue(suffix); c.close(); } }));
  const size = await withUploadRequestBudget(request, async budget => {
    const parsed = await budget.formData();
    const file = parsed.get('file') as File;
    expect(file.size).toBe(MAX_UPLOAD_FILE_BYTES);
    return (await budget.fileBytes(file)).byteLength;
  });
  expect(size).toBe(MAX_UPLOAD_FILE_BYTES);
  await vi.waitFor(() => expect(getUploadBudgetState().activeUploads).toBe(0));
});

it.each([undefined, '1', '0'])('caps actual chunked bytes despite claimed Content-Length=%s', async length => {
  const cancel = vi.fn();
  const request = streamed(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_UPLOAD_BODY_BYTES)); c.enqueue(new Uint8Array([1])); }, cancel }), length);
  await expect(withUploadRequestBudget(request, budget => budget.formData())).rejects.toMatchObject({ status: 413 });
  await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  await vi.waitFor(() => expect(getUploadBudgetState().activeUploads).toBe(0));
});

it('rejects oversized metadata before reading any File arrayBuffer', async () => {
  const file = { size: MAX_UPLOAD_FILE_BYTES + 1, arrayBuffer: vi.fn() } as unknown as File;
  const request = new Request('http://app.test/api/uploads', { method: 'POST' });
  await expect(withUploadRequestBudget(request, budget => budget.fileBytes(file))).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  expect(file.arrayBuffer).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(getUploadBudgetState().activeUploads).toBe(0));
});

it.each(['empty', 'malformed', 'disconnect'])('cancels/releases the slot for %s input', async scenario => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const request = streamed(new ReadableStream({ start(c) {
    if (scenario === 'empty') c.close();
    if (scenario === 'malformed') { c.enqueue(new Uint8Array([1])); c.close(); }
  }, cancel }), undefined, controller.signal);
  const operation = withUploadRequestBudget(request, budget => budget.formData());
  if (scenario === 'disconnect') controller.abort();
  await expect(operation).rejects.toMatchObject({ status: 400 });
  await vi.waitFor(() => expect(getUploadBudgetState().activeUploads).toBe(0));
});

it('returns timeout promptly but retains slot/finalizer until asynchronous body cancellation settles', async () => {
  vi.useFakeTimers();
  const cleanup = deferred();
  const cancel = vi.fn(() => cleanup.promise);
  const before = getDrainState().counters.pendingFinalizers;
  const operation = withUploadRequestBudget(streamed(new ReadableStream({ cancel })), budget => budget.formData());
  const failure = expect(operation).rejects.toMatchObject({ status: 408 });
  await vi.advanceTimersByTimeAsync(30001);
  await failure;
  expect(cancel).toHaveBeenCalled();
  expect(getUploadBudgetState().activeUploads).toBe(1);
  expect(getDrainState().counters.pendingFinalizers).toBeGreaterThan(before);
  cleanup.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(getUploadBudgetState().activeUploads).toBe(0);
  expect(getDrainState().counters.pendingFinalizers).toBe(before);
});

it('limits process uploads to two and holds slots through business/Storage finalization', async () => {
  const finish = deferred();
  const before = getDrainState().counters.pendingFinalizers;
  const first = withUploadRequestBudget(new Request('http://app.test/upload'), async () => { await finish.promise; });
  const second = withUploadRequestBudget(new Request('http://app.test/upload'), async () => { await finish.promise; });
  expect(getUploadBudgetState().activeUploads).toBe(2);
  const cancel = vi.fn();
  await expect(withUploadRequestBudget(streamed(new ReadableStream({ cancel })), async () => { throw new Error('must not run'); })).rejects.toMatchObject({ status: 503, retryable: true });
  expect(cancel).toHaveBeenCalled();
  finish.resolve(); await Promise.all([first, second]);
  await vi.waitFor(() => expect(getUploadBudgetState().activeUploads).toBe(0));
  expect(getDrainState().counters.pendingFinalizers).toBe(before);
});

it('retains a timed-out File conversion until its underlying promise settles', async () => {
  vi.useFakeTimers();
  const cleanup = deferred();
  const before = getDrainState().counters.pendingFinalizers;
  const file = { size: 1, arrayBuffer: async () => { await cleanup.promise; return new Uint8Array([1]).buffer; } } as File;
  const failure = expect(withUploadRequestBudget(new Request('http://app.test/upload'), budget => budget.fileBytes(file))).rejects.toMatchObject({ status: 408 });
  await vi.advanceTimersByTimeAsync(30001); await failure;
  expect(getUploadBudgetState().activeUploads).toBe(1);
  expect(getDrainState().counters.pendingFinalizers).toBeGreaterThan(before);
  cleanup.resolve(); await vi.advanceTimersByTimeAsync(0);
  expect(getUploadBudgetState().activeUploads).toBe(0);
  expect(getDrainState().counters.pendingFinalizers).toBe(before);
});
