import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { ApiRouteError } from '../api-error';

export const MAINTENANCE_FILE = '/etc/zimage/backend-maintenance.json';
export const COUNTERS = ['activeMutations', 'activeStreams', 'activeRenders', 'activeExports', 'pendingFinalizers'] as const;
export type WorkKind = typeof COUNTERS[number];
export type Maintenance = { schemaVersion: 2; operationId: string; mode: 'open' | 'draining' | 'checking' };
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/;
const HTTP_BRIDGE = Symbol.for('zimage.http-admission.v1');
const HTTP_BARRIER = 'node-http-create-server-v1';
type FrameworkAdmission = { protocolVersion: 1; installed: boolean; nextVersion: string; hook: string; controlValid: boolean };
type HttpAdmission = { protocolVersion: 1; barrierId: typeof HTTP_BARRIER; installed: boolean;
  wrappedServerCount: number; activeHttpRequests: number; activeFrameworkWork: number; frameworkWork: FrameworkAdmission; controlValid: boolean;
  schemaVersion: 2; admissionEpoch: string; admissionMode: Maintenance['mode'] };

export function readHttpAdmission(): HttpAdmission {
  if (process.env.ZIMAGE_LIFECYCLE_ENABLED !== '1') {
    return { protocolVersion: 1, barrierId: HTTP_BARRIER, installed: false, wrappedServerCount: 0,
      activeHttpRequests: 0, activeFrameworkWork: 0,
      frameworkWork: { protocolVersion: 1, installed: false, nextVersion: '16.4.1', hook: 'response-cache-revalidate-v1', controlValid: true },
      controlValid: true, schemaVersion: 2, admissionEpoch: 'disabled-local', admissionMode: 'open' };
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, HTTP_BRIDGE);
  const bridge = descriptor?.value;
  if (!descriptor || descriptor.writable !== false || descriptor.configurable !== false
    || !Object.isFrozen(bridge) || bridge?.protocolVersion !== 1 || bridge?.barrierId !== HTTP_BARRIER || bridge?.qaOnly !== false
    || typeof bridge?.snapshot !== 'function') throw new MaintenanceError();
  const state = bridge.snapshot() as HttpAdmission;
  if (!state || state.protocolVersion !== 1 || state.barrierId !== HTTP_BARRIER || state.installed !== true
    || !Number.isSafeInteger(state.wrappedServerCount) || state.wrappedServerCount < 1
    || !Number.isSafeInteger(state.activeHttpRequests) || state.activeHttpRequests < 0
    || !Number.isSafeInteger(state.activeFrameworkWork) || state.activeFrameworkWork < 0
    || state.frameworkWork?.protocolVersion !== 1 || state.frameworkWork.installed !== true
    || state.frameworkWork.nextVersion !== '16.4.1' || state.frameworkWork.hook !== 'response-cache-revalidate-v1'
    || state.frameworkWork.controlValid !== true
    || typeof state.controlValid !== 'boolean' || state.schemaVersion !== 2
    || !['open', 'draining', 'checking'].includes(state.admissionMode)
    || typeof state.admissionEpoch !== 'string') throw new MaintenanceError();
  return state;
}

export class MaintenanceError extends ApiRouteError {
  constructor() {
    super({ code: 'network', status: 503, retryable: true, message: '服务正在维护，请保留原请求编号，稍后重试。' });
  }
}

// A missing, replaced, oversized or untrusted control file closes admission.
// The deploy account and service user must never own this file or its parents.
export function readMaintenance(): Maintenance {
  if (process.env.ZIMAGE_LIFECYCLE_ENABLED !== '1') {
    return { schemaVersion: 2, operationId: 'disabled-local', mode: 'open' };
  }
  for (const path of ['/etc', '/etc/zimage']) {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.uid !== 0 || (info.mode & 0o022)) throw new MaintenanceError();
  }
  const fd = openSync(MAINTENANCE_FILE, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022) || info.nlink !== 1 || info.size > 1024) throw new MaintenanceError();
    const body = JSON.parse(readFileSync(fd, 'utf8')) as Partial<Maintenance>;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== 'mode,operationId,schemaVersion' || body.schemaVersion !== 2
      || !['open', 'draining', 'checking'].includes(body.mode ?? '') || typeof body.operationId !== 'string' || !ID.test(body.operationId)) throw new MaintenanceError();
    return body as Maintenance;
  } finally { closeSync(fd); }
}

export class RequestLifecycle {
  private readonly counts = Object.fromEntries(COUNTERS.map(key => [key, 0])) as Record<WorkKind, number>;
  constructor(private readonly gate: () => Maintenance = readMaintenance, private readonly http: () => HttpAdmission = readHttpAdmission) {}

  admission() {
    try {
      const gate = this.gate(), http = this.http();
      if (gate.mode === 'open' && http.controlValid && (!http.installed
        || (http.admissionMode === gate.mode && http.admissionEpoch === gate.operationId))) return;
    } catch { /* fail closed */ }
    throw new MaintenanceError();
  }

  begin(kind: WorkKind) {
    this.counts[kind]++;
    let ended = false;
    return () => { if (!ended) { ended = true; this.counts[kind]--; } };
  }

  async finalizer<T>(operation: () => Promise<T>): Promise<T> {
    const end = this.begin('pendingFinalizers');
    try { return await operation(); } finally { end(); }
  }

  snapshot() {
    let gate: Maintenance;
    let http: HttpAdmission;
    let controlValid = true;
    try { gate = this.gate(); } catch { controlValid = false; gate = { schemaVersion: 2, mode: 'draining', operationId: 'invalid-control' }; }
    try {
      http = this.http();
      if (!http.controlValid || (http.installed && (http.admissionMode !== gate.mode || http.admissionEpoch !== gate.operationId))) controlValid = false;
    } catch {
      controlValid = false;
      http = { protocolVersion: 1, barrierId: HTTP_BARRIER, installed: false, wrappedServerCount: 0,
        activeHttpRequests: 0, activeFrameworkWork: 0,
        frameworkWork: { protocolVersion: 1, installed: false, nextVersion: '16.4.1', hook: 'response-cache-revalidate-v1', controlValid: false },
        controlValid: false, schemaVersion: 2, admissionMode: 'draining', admissionEpoch: 'invalid-control' };
    }
    const counters = { ...this.counts };
    return { schemaVersion: 1, backendRelease: process.env.ZIMAGE_BUILD_SHA ?? 'development', pid: process.pid,
      maintenance: gate.mode !== 'open', admissionMode: gate.mode, admissionEpoch: gate.operationId, controlValid, counters,
      activeHttpRequests: http.activeHttpRequests, activeFrameworkWork: http.activeFrameworkWork, httpAdmission: http,
      drained: controlValid && gate.mode === 'draining' && http.activeHttpRequests === 0 && http.activeFrameworkWork === 0 && COUNTERS.every(key => counters[key] === 0) };
  }

  async route(handler: () => Promise<Response>): Promise<Response> {
    const end = this.begin('activeMutations');
    try {
      const response = await handler();
      const mime = response.headers.get('content-type') ?? '';
      const kind = mime.startsWith('text/event-stream') ? 'activeStreams'
        : mime.startsWith('application/zip') || /attachment/i.test(response.headers.get('content-disposition') ?? '') ? 'activeExports' : undefined;
      if (!kind || !response.body) return response;
      const finishBody = this.begin(kind);
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const result = await reader.read();
            if (result.done) { controller.close(); finishBody(); } else controller.enqueue(result.value);
          } catch (error) { finishBody(); controller.error(error); }
        },
        async cancel(reason) {
          try { await reader.cancel(reason); } finally { finishBody(); }
        },
      }, { highWaterMark: 0 });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally { end(); }
  }
}

// Next may bundle Route Handlers and instrumentation separately. A process-wide
// singleton makes the management socket observe their same counters.
const shared = globalThis as typeof globalThis & { __zimageLifecycle?: RequestLifecycle };
export const lifecycle = shared.__zimageLifecycle ??= new RequestLifecycle();
// Construct the route bundle's error class even if instrumentation created the
// shared collector from another Next chunk (class identities may differ).
export const assertMutationAdmission = () => { try { lifecycle.admission(); } catch { throw new MaintenanceError(); } };
export const beginWork = (kind: WorkKind) => lifecycle.begin(kind);
export const trackFinalizer = <T>(operation: () => Promise<T>) => lifecycle.finalizer(operation);
export const runTrackedRoute = (handler: () => Promise<Response>) => lifecycle.route(handler);
export const getDrainState = () => lifecycle.snapshot();
