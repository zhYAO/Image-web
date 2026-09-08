import { ImageProviderError } from '../_shared/image-providers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { processClaim, type ClaimedGeneration, type ResultCheckpoint } from '../_shared/generation-runner';

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
  it('renews during work exceeding the old 120 second visibility', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.provider.mockImplementation(async () => { await new Promise(r => setTimeout(r, 150_000)); return result; });
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(151_000);
    expect(await running).toMatchObject({ action: 'completed' });
    expect(f.renewals).toBeGreaterThanOrEqual(5); expect(f.provider).toHaveBeenCalledTimes(1);
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
  it('bounds a hung provider by the overall execution deadline', async () => {
    vi.useFakeTimers(); const f = fixture(); f.provider.mockImplementation(() => new Promise(() => {}));
    const running = processClaim(f.admin, claim, { callProvider: f.provider });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await running).toMatchObject({ action: 'deferred' });
    expect(f.objects.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
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

});
