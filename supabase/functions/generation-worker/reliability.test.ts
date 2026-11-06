import { ImageProviderError } from '../_shared/image-providers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generationQueueRpc, parseClaim, processClaim, type ClaimedGeneration, type ResultCheckpoint } from '../_shared/generation-runner';

const id = '11111111-1111-4111-8111-111111111111';
const claim: ClaimedGeneration = { action: 'process', generationId: id, batchId: id, sessionId: id, userId: id,
  claimToken: id, messageId: 1, readCount: 1, provider: 'gemini', model: 'model', prompt: 'product',
  params: { aspectRatio: '1:1', resolution: '1K' }, references: [] };
const result = { bytesBase64: 'aW1hZ2U=', mimeType: 'image/png', providerRequestId: 'request-1' } as const;

// Only the external RPC/storage/provider boundary is replaced. The production runner
// decides all ordering, retry, renewal, recovery and cancellation behavior.
function fixture() {
  let phase = 'claimed';
  let checkpoint: ResultCheckpoint | null = null;
  let live = true;
  let token = id;
  let completionFailures = 0;
  let responseLost = false;
  let renewals = 0;
  let checkpointFailures = 0;
  let failRenew = false;
  let afterUpload: (() => void) | undefined;
  const objects = new Map<string, Uint8Array>();
  const assets = new Set<string>();
  const events: string[] = [];
  const provider = vi.fn(async () => result);
  const admin = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      events.push(name === 'generation_worker_step' ? String(args.p_operation) : name);
      if (name === 'assert_chat_provider_available') return { data: true, error: null };
      if (name === 'generation_worker_step') {
        if (args.p_claim_token !== token || !live) return { data: { accepted: false }, error: null };
        const op = args.p_operation;
        if (op === 'renew') { renewals++; if (failRenew) return { data: null, error: { message: 'offline' } }; }
        if (op === 'checkpoint' && checkpointFailures-- > 0) return { data: null, error: { message: 'offline' } };
        if (op === 'submitted') { if (phase !== 'claimed') return { data: { accepted: false }, error: null }; phase = 'submitted'; }
        if (op === 'checkpoint') { phase = 'result'; checkpoint = args.p_payload as unknown as ResultCheckpoint; }
        if (op === 'uploaded') phase = 'uploaded';
        if (op === 'complete') {
          if (completionFailures-- > 0) return { data: null, error: { message: 'transient' } };
          if (!checkpoint || !objects.has(String(checkpoint.storagePath))) throw new Error('completion_without_durable_object');
          assets.add(String(checkpoint.storagePath)); phase = 'completed';
          if (responseLost) { responseLost = false; return { data: null, error: { message: 'response_lost' } }; }
        }
        return { data: { accepted: true }, error: null };
      }
      // Existing worker RPCs intentionally stay available to expose its original behavior.
      if (name === 'mark_provider_submission_started') return { data: true, error: null };
      if (name === 'complete_image_generation') return { data: null, error: { message: 'transient' } };
      return { data: null, error: null };
    },
    storage: { from: () => ({
      download: async () => ({ data: null, error: null }),
      upload: async (path: string, bytes: Uint8Array) => {
        events.push('upload'); objects.set(path, bytes); afterUpload?.(); return { error: null };
      },
    }) },
  };
  return { admin, provider, objects, assets, events, get checkpoint() { return checkpoint; },
    get phase() { return phase; }, get renewals() { return renewals; },
    delete: () => { live = false; }, fence: () => { token = 'new-token'; },
    failCompletion: (count: number) => { completionFailures = count; },
    loseResponse: () => { responseLost = true; },
    failCheckpoint: () => { checkpointFailures = 3; },
    failRenew: () => { failRenew = true; },
    afterUpload: (callback: () => void) => { afterUpload = callback; } };
}

afterEach(() => vi.useRealTimers());
describe('generation worker reliability', () => {
  it('retries a completion write from its durable result without another provider call', async () => {
    const f = fixture(); f.failCompletion(3);
    await processClaim(f.admin, claim, { callProvider: f.provider });
    expect(f.checkpoint).toMatchObject({ bytesBase64: 'aW1hZ2U=', mimeType: 'image/png' });
    expect(f.assets.size).toBe(0);
    await processClaim(f.admin, { ...claim, action: 'recover', checkpoint: f.checkpoint ?? undefined }, { callProvider: f.provider });
    expect(f.provider).toHaveBeenCalledTimes(1);
    expect(f.assets.size).toBe(1);
  });
  it('treats completion response loss idempotently', async () => {
    const f = fixture(); f.loseResponse();
    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'completed' });
    expect(f.assets.size).toBe(1); expect(f.provider).toHaveBeenCalledTimes(1);
  });
  it('renews while the provider runs within the Free execution budget', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.provider.mockImplementation(async () => { await new Promise(r => setTimeout(r, 80_000)); return result; });
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(81_000);
    expect(await running).toMatchObject({ action: 'completed' });
    expect(f.renewals).toBeGreaterThanOrEqual(4); expect(f.provider).toHaveBeenCalledTimes(1);
  });
  it('prevents an upload when deletion happens while provider work is in flight', async () => {
    const f = fixture(); f.provider.mockImplementation(async () => { f.delete(); return result; });
    await processClaim(f.admin, claim, { callProvider: f.provider });
    expect(f.objects.size).toBe(0); expect(f.assets.size).toBe(0);
  });
  it('cannot upload or complete after its lease token has been replaced', async () => {
    const f = fixture(); f.provider.mockImplementation(async () => { f.fence(); return result; });
    await processClaim(f.admin, claim, { callProvider: f.provider });
    expect(f.objects.size).toBe(0); expect(f.assets.size).toBe(0);
  });
  it('registers the result path and bytes before writing the object', async () => {
    const f = fixture(); await processClaim(f.admin, claim, { callProvider: f.provider });
    expect(f.events.indexOf('checkpoint')).toBeGreaterThanOrEqual(0);
    expect(f.events.indexOf('checkpoint')).toBeLessThan(f.events.indexOf('upload'));
  });
  it('does not upload bytes whose checkpoint could not be persisted', async () => {
    const f = fixture(); f.failCheckpoint();
    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'deferred' });
    expect(f.objects.size).toBe(0); expect(f.provider).toHaveBeenCalledTimes(1);
  });
  it('keeps a durable compensation path when deletion wins during an upload', async () => {
    const f = fixture(); f.afterUpload(f.delete);
    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'deferred' });
    expect(f.assets.size).toBe(0);
    expect(f.objects.size).toBe(1);
    expect(f.objects.has(f.checkpoint!.storagePath)).toBe(true);
  });
  it('leaves unknown provider outcomes for reconciliation instead of ordinary failed retry', async () => {
    const f = fixture(); f.provider.mockRejectedValue(new Error('response_lost'));
    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'reconcile' });
    expect(f.events).toContain('unknown'); expect(f.events).not.toContain('fail');
    expect(f.provider).toHaveBeenCalledTimes(1); expect(f.objects.size).toBe(0);
  });
  it('aborts work and prevents a late upload after a renewal transport failure', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.provider.mockImplementation(async () => {
      f.failRenew(); await new Promise(r => setTimeout(r, 80_000)); return result;
    });
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(26_000);
    expect(await running).toMatchObject({ action: 'deferred' });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.objects.size).toBe(0); expect(f.assets.size).toBe(0);
  });
  it('clears the provider stage timer as soon as lease renewal fails', async () => {
    vi.useFakeTimers(); const f = fixture(); f.failRenew();
    // Initial renewal must succeed; fail only the interval while provider waits.
    const originalRpc = f.admin.rpc; let renewals = 0;
    f.admin.rpc = async (name, args) => {
      if (name === 'generation_worker_step' && args?.p_operation === 'renew' && ++renewals === 1) return { data: { accepted: true }, error: null };
      return originalRpc(name, args);
    };
    f.provider.mockImplementation(() => new Promise(() => {}));
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(26_000);
    expect(await running).toMatchObject({ action: 'deferred' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('journals an unresponsive provider as unknown before the Free execution deadline', async () => {
    vi.useFakeTimers(); const f = fixture(); f.provider.mockImplementation(() => new Promise(() => {}));
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(91_000);
    expect(await Promise.race([running, Promise.resolve({ action: 'still_running' })])).toMatchObject({ action: 'reconcile' });
    expect(f.events).toContain('unknown'); expect(f.events).not.toContain('fail');
    expect(f.objects.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('never uploads a provider result that arrives after its deadline', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.provider.mockImplementation(async () => { await new Promise(r => setTimeout(r, 95_000)); return result; });
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(91_000);
    expect(await Promise.race([running, Promise.resolve({ action: 'still_running' })])).toMatchObject({ action: 'reconcile' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.checkpoint).toBeNull(); expect(f.objects.size).toBe(0); expect(f.assets.size).toBe(0);
    expect(f.events).not.toContain('fail'); expect(f.provider).toHaveBeenCalledTimes(1);
  });

  it('does not submit after preparation times out or download the next reference late', async () => {
    vi.useFakeTimers(); const f = fixture(); let downloads = 0;
    f.admin.storage.from = () => ({
      download: async () => { downloads++; await new Promise(r => setTimeout(r, 30_000)); return { data: new Blob(['image']), error: null }; },
      upload: async () => ({ error: null }),
    });
    const reference = { id, bucket: 'uploads', path: 'synthetic', mimeType: 'image/png' } as const;
    const running = processClaim(f.admin, { ...claim, params: { ...claim.params, referenceIds: [id, id] }, references: [reference, reference] }, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await Promise.race([running, Promise.resolve({ action: 'still_running' })])).toMatchObject({ action: 'retry' });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(downloads).toBe(1); expect(f.events).not.toContain('submitted'); expect(f.provider).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('yields a late durable checkpoint and recovers it without another provider attempt', async () => {
    vi.useFakeTimers(); const f = fixture(); const originalRpc = f.admin.rpc;
    f.admin.rpc = async (name, args) => {
      if (name === 'generation_worker_step' && args?.p_operation === 'checkpoint') await new Promise(r => setTimeout(r, 30_000));
      return originalRpc(name, args);
    };
    f.provider.mockImplementation(async () => { await new Promise(r => setTimeout(r, 80_000)); return result; });
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(111_000);
    expect(await running).toMatchObject({ action: 'deferred', code: 'generation_checkpoint_saved' });
    expect(f.phase).toBe('result'); expect(f.objects.size).toBe(0);
    expect(await processClaim(f.admin, { ...claim, action: 'recover', checkpoint: f.checkpoint ?? undefined }, { callProvider: f.provider })).toMatchObject({ action: 'completed' });
    expect(f.provider).toHaveBeenCalledTimes(1); expect(f.assets.size).toBe(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('yields before uploading when the preceding renewal consumes its reserved time', async () => {
    vi.useFakeTimers(); const f = fixture(); const originalRpc = f.admin.rpc;
    f.admin.rpc = async (name, args) => {
      if (name === 'generation_worker_step' && args?.p_operation === 'renew' && f.phase === 'result') await new Promise(r => setTimeout(r, 30_000));
      return originalRpc(name, args);
    };
    f.provider.mockImplementation(async () => { await new Promise(r => setTimeout(r, 80_000)); return result; });
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(111_000);
    expect(await running).toMatchObject({ action: 'deferred', code: 'generation_checkpoint_saved' });
    expect(f.phase).toBe('result'); expect(f.events).not.toContain('upload'); expect(f.assets.size).toBe(0);
  });

  it('does not retry an upload when the first failure has consumed the reserved time', async () => {
    vi.useFakeTimers(); const f = fixture(); let uploads = 0; const originalStorage = f.admin.storage.from;
    f.admin.storage.from = () => ({ download: async () => ({ data: null, error: null }), upload: async () => {
      uploads++; await new Promise(r => setTimeout(r, 35_000)); return { error: { message: 'synthetic outage' } };
    } });
    f.provider.mockImplementation(async () => { await new Promise(r => setTimeout(r, 70_000)); return result; });
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(121_000);
    expect(await running).toMatchObject({ action: 'deferred', code: 'generation_checkpoint_saved' });
    expect(uploads).toBe(1); expect(f.phase).toBe('result'); expect(f.assets.size).toBe(0);
    f.admin.storage.from = originalStorage;
    expect(await processClaim(f.admin, { ...claim, action: 'recover', checkpoint: f.checkpoint ?? undefined }, { callProvider: f.provider })).toMatchObject({ action: 'completed' });
    expect(f.provider).toHaveBeenCalledTimes(1); expect(f.assets.size).toBe(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leave an unhandled rejection when the deadline expires during completion backoff', async () => {
    vi.useFakeTimers(); const f = fixture(); const originalRpc = f.admin.rpc; let completion = true;
    f.admin.rpc = async (name, args) => {
      if (name === 'generation_worker_step' && args?.p_operation === 'complete' && completion) {
        completion = false; await new Promise(r => setTimeout(r, 119_900));
        return { data: null, error: { message: 'synthetic timeout' } };
      }
      return originalRpc(name, args);
    };
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(121_000);
    expect(await running).toMatchObject({ action: 'deferred' });
    expect(f.phase).toBe('uploaded'); expect(f.assets.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    // Vitest also fails this test run on any unhandled rejected step promise.
  });

  it('bounds a hung Storage upload and recovers its checkpoint', async () => {
    vi.useFakeTimers(); const f = fixture(); const storage = f.admin.storage.from;
    f.admin.storage.from = () => ({ download: async () => ({ data: null, error: null }), upload: async () => new Promise(() => {}) });
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(121_000);
    expect(await Promise.race([running, Promise.resolve({ action: 'still_running' })])).toMatchObject({ action: 'deferred' });
    expect(f.phase).toBe('result'); expect(f.assets.size).toBe(0);
    f.admin.storage.from = storage;
    expect(await processClaim(f.admin, { ...claim, action: 'recover', checkpoint: f.checkpoint ?? undefined }, { callProvider: f.provider })).toMatchObject({ action: 'completed' });
    expect(f.provider).toHaveBeenCalledTimes(1); expect(f.assets.size).toBe(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('reconciles ambiguous typed provider errors instead of making them ordinary failures', async () => {
    const f = fixture(); f.provider.mockRejectedValue(new ImageProviderError('provider_error', 'provider_response_missing_image', false));
    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'reconcile' });
    expect(f.events).toContain('unknown'); expect(f.events).not.toContain('fail');
    expect(f.provider).toHaveBeenCalledTimes(1); expect(f.objects.size).toBe(0);
  });

  it('allows ordinary failure only for an explicit confirmed rejection', async () => {
    const f = fixture(); f.provider.mockRejectedValue(new ImageProviderError('moderation', 'provider_content_blocked', false, 'rejected'));
    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'failed' });
    expect(f.events).toContain('fail'); expect(f.events).not.toContain('unknown');
    expect(f.provider).toHaveBeenCalledTimes(1);
  });

  it('finalizes a definite rejection when the separate safety audit endpoint is unavailable', async () => {
    const f = fixture();
    const originalRpc = f.admin.rpc;
    f.admin.rpc = async (name, args) => {
      if (name === 'record_image_safety_decision') {
        f.events.push(name);
        return { data: null, error: { message: 'audit_transport_unavailable' } };
      }
      return originalRpc(name, args);
    };
    f.provider.mockRejectedValue(new ImageProviderError('moderation', 'provider_content_blocked', false, 'rejected'));

    // The database test must separately prove that rejection and its audit are
    // atomic; this runner regression guards the independent audit RPC outage.
    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'failed', code: 'moderation' });
    expect(f.events).toContain('fail');
    expect(f.events).not.toContain('unknown');
    expect(f.provider).toHaveBeenCalledTimes(1);
    expect(f.objects.size).toBe(0);
  });

  it('retries rejection finalization after a transport error without another provider call', async () => {
    const f = fixture();
    const originalRpc = f.admin.rpc;
    let failures = 1;
    f.admin.rpc = async (name, args) => {
      if (name === 'generation_worker_step' && args?.p_operation === 'fail' && failures-- > 0) {
        f.events.push('fail_transport_error');
        return { data: null, error: { message: 'transient' } };
      }
      return originalRpc(name, args);
    };
    f.provider.mockRejectedValue(new ImageProviderError('moderation', 'provider_content_blocked', false, 'rejected'));

    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'failed', code: 'moderation' });
    expect(f.events).toContain('fail_transport_error');
    expect(f.events).toContain('fail');
    expect(f.provider).toHaveBeenCalledTimes(1);
    expect(f.objects.size).toBe(0);
  });

  it('does not write a rejection audit after its lease token has been replaced', async () => {
    const f = fixture();
    f.provider.mockImplementation(async () => {
      f.fence();
      throw new ImageProviderError('moderation', 'provider_content_blocked', false, 'rejected');
    });

    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'deferred' });
    expect(f.events).not.toContain('record_image_safety_decision');
    expect(f.provider).toHaveBeenCalledTimes(1);
    expect(f.objects.size).toBe(0);
  });

  it('checkpoints a definite rejection before attempting its finalization', async () => {
    const f = fixture();
    f.provider.mockRejectedValue(new ImageProviderError('moderation', 'provider_content_blocked', false, 'rejected'));
    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'failed' });
    expect(f.events.indexOf('checkpoint_rejection')).toBeGreaterThan(f.events.indexOf('submitted'));
    expect(f.events.indexOf('checkpoint_rejection')).toBeLessThan(f.events.indexOf('fail'));
    expect(f.events).not.toContain('record_image_safety_decision');
  });

  it('leaves a rejection pending when its durable checkpoint cannot be written', async () => {
    const f = fixture(); const originalRpc = f.admin.rpc;
    f.admin.rpc = async (name, args) => {
      if (name === 'generation_worker_step' && args?.p_operation === 'checkpoint_rejection') {
        f.events.push('checkpoint_rejection');
        return { data: null, error: { message: 'offline' } };
      }
      return originalRpc(name, args);
    };
    f.provider.mockRejectedValue(new ImageProviderError('moderation', 'provider_content_blocked', false, 'rejected'));
    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'deferred' });
    expect(f.events.filter(event => event === 'checkpoint_rejection')).toHaveLength(3);
    expect(f.events).not.toContain('fail'); expect(f.events).not.toContain('unknown');
    expect(f.provider).toHaveBeenCalledTimes(1);
  });

  it('recovers only finalization after an audit transaction keeps failing', async () => {
    const f = fixture(); const originalRpc = f.admin.rpc;
    let savedCode: unknown; let failures = 3;
    f.admin.rpc = async (name, args) => {
      if (name === 'generation_worker_step' && args?.p_operation === 'checkpoint_rejection') {
        savedCode = (args.p_payload as Record<string, unknown>).code;
      }
      if (name === 'generation_worker_step' && args?.p_operation === 'fail' && failures-- > 0) {
        f.events.push('audit_transaction_error');
        return { data: null, error: { message: 'audit_insert_failed' } };
      }
      return originalRpc(name, args);
    };
    f.provider.mockRejectedValue(new ImageProviderError('moderation', 'provider_content_blocked', false, 'rejected'));
    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'deferred' });
    expect(savedCode).toBe('moderation');
    expect(f.events.filter(event => event === 'audit_transaction_error')).toHaveLength(3);
    const recovery = parseClaim({ ...claim, action: 'recover_rejection', rejectionCode: savedCode });
    expect(await processClaim(f.admin, recovery as ClaimedGeneration, { callProvider: f.provider })).toMatchObject({ action: 'failed', code: 'moderation' });
    expect(f.events.filter(event => event === 'checkpoint_rejection')).toHaveLength(1);
    expect(f.events).not.toContain('unknown'); expect(f.provider).toHaveBeenCalledTimes(1);
  });

  it('replays finalization after its response is lost without buying or checkpointing again', async () => {
    const f = fixture(); const originalRpc = f.admin.rpc; let responseLost = true;
    f.admin.rpc = async (name, args) => {
      const response = await originalRpc(name, args);
      if (name === 'generation_worker_step' && args?.p_operation === 'fail' && responseLost) {
        responseLost = false;
        return { data: null, error: { message: 'response_lost' } };
      }
      return response;
    };
    f.provider.mockRejectedValue(new ImageProviderError('provider_error', 'provider_rejected', false, 'rejected'));
    expect(await processClaim(f.admin, claim, { callProvider: f.provider })).toMatchObject({ action: 'failed', code: 'provider_error' });
    expect(f.events.filter(event => event === 'fail')).toHaveLength(2);
    expect(f.events.filter(event => event === 'checkpoint_rejection')).toHaveLength(1);
    expect(f.provider).toHaveBeenCalledTimes(1);
  });

  it('recovers a durable rejection without provider availability, references or storage work', async () => {
    const f = fixture(); const originalRpc = f.admin.rpc;
    f.admin.rpc = async (name, args) => {
      if (name === 'assert_chat_provider_available') throw new Error('provider_disabled');
      return originalRpc(name, args);
    };
    const recovery = parseClaim({ ...claim, action: 'recover_rejection', rejectionCode: 'moderation',
      params: { ...claim.params, referenceIds: [id] }, references: [] });
    expect(recovery).toMatchObject({ action: 'recover_rejection', rejectionCode: 'moderation' });
    expect(await processClaim(f.admin, recovery as ClaimedGeneration, { callProvider: f.provider })).toMatchObject({ action: 'failed', code: 'moderation' });
    expect(f.provider).not.toHaveBeenCalled(); expect(f.objects.size).toBe(0);
    expect(f.events).toEqual(['renew', 'fail']);
  });

  it.each([undefined, null, 'reference_download_failed', 'provider_reconciliation_required'])('rejects a recovery claim with invalid rejection code %s', code => {
    expect(() => parseClaim({ ...claim, action: 'recover_rejection', rejectionCode: code })).toThrow('invalid_queue_claim');
  });

});


describe('bounded generation queue control', () => {
  it('returns the queue response without leaking a timer', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.admin.rpc = async () => ({ data: { action: 'archive', messageId: 1, reason: 'terminal' }, error: null });
    expect(await generationQueueRpc(f.admin, 'claim_image_generation')).toMatchObject({ action: 'archive' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops waiting for a claim after ten seconds and never returns the late lease', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.admin.rpc = async () => { await new Promise(r => setTimeout(r, 30_000)); return { data: claim, error: null }; };
    const outcome = generationQueueRpc(f.admin, 'claim_image_generation').then(() => 'claimed', () => 'deferred');
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await Promise.race([outcome, Promise.resolve('still_running')])).toBe('deferred');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await outcome).toBe('deferred'); expect(vi.getTimerCount()).toBe(0);
  });
});
