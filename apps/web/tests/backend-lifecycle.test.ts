import { describe, expect, it, vi } from 'vitest';
import { MaintenanceError, RequestLifecycle, getDrainState } from '@/server/lifecycle/request-lifecycle';
import { zipCommerceStream } from '@/server/commerce/commerce-export';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

describe('backend drain lifecycle', () => {
  const admission = (mode: 'open' | 'draining' | 'checking', activeHttpRequests = 0, operationId = 'operation-1') => ({
    protocolVersion: 1 as const, barrierId: 'node-http-create-server-v1' as const, installed: true,
    wrappedServerCount: 1, activeHttpRequests, activeFrameworkWork: 0,
    frameworkWork: { protocolVersion: 1 as const, installed: true, nextVersion: '16.4.1', hook: 'response-cache-revalidate-v1', controlValid: true },
    controlValid: true, schemaVersion: 2 as const,
    admissionMode: mode, admissionEpoch: operationId,
  });

  it('cannot authorize stop while checking or while an HTTP callback is still active', () => {
    let mode: 'draining' | 'checking' = 'checking', active = 0;
    const state = new RequestLifecycle(() => ({ schemaVersion: 2, operationId: 'operation-1', mode }), () => admission(mode, active));
    expect(state.snapshot()).toMatchObject({ admissionMode: 'checking', maintenance: true, activeHttpRequests: 0, drained: false });
    mode = 'draining'; active = 1;
    expect(state.snapshot().drained).toBe(false);
    active = 0;
    expect(state.snapshot()).toMatchObject({ admissionMode: 'draining', activeHttpRequests: 0, drained: true });
  });

  it('cannot drain while a detached framework cache operation remains active', () => {
    let activeFrameworkWork = 1;
    const state = new RequestLifecycle(() => ({ schemaVersion: 2, operationId: 'operation-1', mode: 'draining' }),
      () => ({ ...admission('draining'), activeFrameworkWork }));
    expect(state.snapshot()).toMatchObject({ activeHttpRequests: 0, activeFrameworkWork: 1, drained: false });
    activeFrameworkWork = 0;
    expect(state.snapshot().drained).toBe(true);
  });

  it('rejects mixed operation snapshots and keeps child finalizers ungated', async () => {
    const state = new RequestLifecycle(() => ({ schemaVersion: 2, operationId: 'operation-1', mode: 'draining' }), () => admission('draining', 0, 'operation-2'));
    expect(state.snapshot()).toMatchObject({ controlValid: false, drained: false });
    expect(() => state.admission()).toThrow(MaintenanceError);
    let finalized = false;
    await state.finalizer(async () => { finalized = true; });
    expect(finalized).toBe(true);
  });

  it('fails closed without the Node preload when lifecycle is enabled', () => {
    vi.stubEnv('ZIMAGE_LIFECYCLE_ENABLED', '1');
    try {
      const state = new RequestLifecycle(() => ({ schemaVersion: 2, operationId: 'operation-1', mode: 'draining' }));
      expect(state.snapshot()).toMatchObject({ controlValid: false, drained: false, httpAdmission: { installed: false } });
      expect(() => state.admission()).toThrow(MaintenanceError);
    } finally { vi.unstubAllEnvs(); }
  });

  it('rejects writes before reservation and fails closed when the persistent gate is invalid', async () => {
    let reservations = 0;
    for (const gate of [() => ({ schemaVersion: 2 as const, operationId: 'operation-1', mode: 'draining' as const }), () => { throw new Error('missing control'); }]) {
      const state = new RequestLifecycle(gate);
      await expect(state.route(async () => { state.admission(); reservations++; return Response.json({}); })).rejects.toBeInstanceOf(MaintenanceError);
      expect(state.snapshot().counters.activeMutations).toBe(0);
    }
    expect(reservations).toBe(0);
  });

  it('holds a disconnected SSE producer until its database/Storage/credit cleanup finishes', async () => {
    const state = new RequestLifecycle(() => ({ schemaVersion: 2, operationId: 'operation-1', mode: 'draining' }));
    const cleanup = deferred();
    let producer!: Promise<void>;
    const response = await state.route(async () => new Response(new ReadableStream({
      start(controller) {
        producer = state.finalizer(async () => { await cleanup.promise; try { controller.close(); } catch { /* cancellation */ } });
      },
    }), { headers: { 'content-type': 'text/event-stream', 'set-cookie': 'session=refresh; HttpOnly' } }));
    expect(response.headers.get('set-cookie')).toContain('session=refresh');
    await response.body!.cancel();
    expect(state.snapshot()).toMatchObject({ drained: false, counters: { activeStreams: 0, activeMutations: 0, pendingFinalizers: 1 } });
    cleanup.resolve(); await producer;
    expect(state.snapshot().drained).toBe(true);
  });

  it('does not mistake a returned ZIP Response for a consumed export', async () => {
    const state = new RequestLifecycle(() => ({ schemaVersion: 2, operationId: 'operation-1', mode: 'draining' }));
    const response = await state.route(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }), { headers: { 'content-type': 'application/zip' } }));
    expect(state.snapshot()).toMatchObject({ drained: false, counters: { activeExports: 1 } });
    await response.arrayBuffer();
    expect(state.snapshot().drained).toBe(true);
  });

  it('keeps the actual ZIP iterator counted across cancellation during a pending source download', async () => {
    const source = deferred(), cleanup = deferred(), entered = deferred();
    async function* files() {
      try { entered.resolve(); await source.promise; yield { name: 'image.jpg', bytes: new Uint8Array([1, 2]) }; }
      finally { await cleanup.promise; }
    }
    const before = getDrainState().counters;
    const reader = zipCommerceStream(files()).getReader();
    await entered.promise;
    const cancelled = reader.cancel();
    source.resolve();
    await Promise.resolve();
    expect(getDrainState().counters.activeExports).toBe(before.activeExports + 1);
    expect(getDrainState().counters.pendingFinalizers).toBe(before.pendingFinalizers + 1);
    cleanup.resolve(); await cancelled;
    expect(getDrainState().counters).toEqual(before);
  });
});
