import { ApiRouteError } from '../api-error';
import { MaintenanceError, trackFinalizer } from '../lifecycle/request-lifecycle';

export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_FILE_BYTES + 256 * 1024;
export const UPLOAD_INGESTION_TIMEOUT_MS = 30_000;
export const MAX_CONCURRENT_UPLOADS = 2;
const shared = globalThis as typeof globalThis & { __zimageUploadBudget?: { activeUploads: number } };
const state = shared.__zimageUploadBudget ??= { activeUploads: 0 };
export const getUploadBudgetState = () => ({ ...state });

class UploadCapacityError extends MaintenanceError {
  constructor() { super(); this.message = '当前上传较多，请保留参考图，稍后重试。'; }
}

function invalid(message: string, status = 400, retryable = false) {
  return new ApiRouteError({ code: status === 408 ? 'network' : 'bad_request', status, retryable, details: { field: 'file' }, message });
}

export class UploadRequestBudget {
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private consumed = false;
  private cancelled = false;
  private finished = false;
  private failure?: ApiRouteError;
  private readonly tasks: Promise<unknown>[] = [];
  private readonly stopped: Promise<never>;
  private rejectStopped!: (error: ApiRouteError) => void;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly onAbort = () => this.fail(invalid('上传连接已断开，请重新上传。', 400, true));

  constructor(private readonly request: Request, private readonly release: () => void) {
    this.stopped = new Promise<never>((_resolve, reject) => { this.rejectStopped = reject; });
    // A failure can arrive before the first guarded operation (e.g. during auth).
    void this.stopped.catch(() => undefined);
    this.timer = setTimeout(() => this.fail(invalid('上传接收超时，请重新上传。', 408, true)), UPLOAD_INGESTION_TIMEOUT_MS);
    request.signal.addEventListener('abort', this.onAbort, { once: true });
    if (request.signal.aborted) this.onAbort();
  }

  private cancel() {
    if (this.cancelled || this.consumed || !this.request.body) return;
    this.cancelled = true;
    const cancellation = trackFinalizer(async () => {
      try {
        if (this.reader) await this.reader.cancel(this.failure);
        else if (!this.request.body!.locked) await this.request.body!.cancel(this.failure);
      } catch { /* A disconnected/errored body has already stopped. */ }
    });
    this.tasks.push(cancellation);
  }

  private fail(error: ApiRouteError) {
    if (this.failure) return;
    this.failure = error;
    this.rejectStopped(error);
    this.cancel();
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    if (this.failure) throw this.failure;
    const task = operation();
    this.tasks.push(task);
    try { return await Promise.race([task, this.stopped]); }
    catch (error) {
      const failure = this.failure ?? (error instanceof ApiRouteError ? error : invalid('上传内容无效或连接已断开，请重新上传。', 400, true));
      this.fail(failure);
      throw failure;
    }
  }

  async formData(): Promise<FormData> {
    return this.guard(async () => {
      const contentType = this.request.headers.get('content-type') ?? '';
      if (!/^multipart\/form-data\s*;/i.test(contentType) || !/\bboundary=/i.test(contentType)) throw invalid('上传请求必须包含有效的 multipart 文件。');
      const length = this.request.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw invalid('上传请求长度无效。');
      if (length !== null && Number(length) > MAX_UPLOAD_BODY_BYTES) throw invalid('参考图文件及上传字段超过大小限制。', 413);
      if (!this.request.body) throw invalid('请选择一张参考图。');
      this.reader = this.request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const part = await this.reader.read();
          if (this.failure) throw this.failure;
          if (part.done) { this.consumed = true; break; }
          total += part.value.byteLength;
          if (total > MAX_UPLOAD_BODY_BYTES) throw invalid('参考图文件及上传字段超过大小限制。', 413);
          chunks.push(part.value);
        }
      } finally {
        this.reader.releaseLock();
        this.reader = undefined;
      }
      if (!total) throw invalid('请选择一张参考图。');
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      // Only bounded bytes reach the multipart parser. Content-Length is never
      // the enforcement mechanism, and a second file cannot expand the budget.
      return new Response(bytes, { headers: { 'content-type': contentType } }).formData();
    });
  }

  async fileBytes(file: File): Promise<Uint8Array> {
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_UPLOAD_FILE_BYTES) {
      const error = invalid('参考图必须小于或等于 10 MB。');
      this.fail(error);
      throw error;
    }
    const bytes = await this.guard(async () => new Uint8Array(await file.arrayBuffer()));
    if (bytes.byteLength !== file.size || bytes.byteLength > MAX_UPLOAD_FILE_BYTES) throw invalid('参考图实际大小无效。');
    this.stopIngestion();
    return bytes;
  }

  private stopIngestion() {
    clearTimeout(this.timer);
    this.request.signal.removeEventListener('abort', this.onAbort);
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.stopIngestion();
    this.cancel();
    // A timeout response can leave cancel/parser/File promises settling. Keep
    // both its memory slot and drain finalizer until every started task settles.
    void trackFinalizer(async () => {
      try { await Promise.allSettled(this.tasks); } finally { this.release(); }
    });
  }
}

export async function withUploadRequestBudget<T>(request: Request, handler: (budget: UploadRequestBudget) => Promise<T>): Promise<T> {
  if (state.activeUploads >= MAX_CONCURRENT_UPLOADS) {
    if (request.body && !request.body.locked) void trackFinalizer(async () => { try { await request.body!.cancel(); } catch { /* disconnected */ } });
    throw new UploadCapacityError();
  }
  state.activeUploads++;
  const budget = new UploadRequestBudget(request, () => { state.activeUploads--; });
  try { return await handler(budget); } finally { budget.finish(); }
}
