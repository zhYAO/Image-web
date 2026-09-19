import { Blob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { parseClaim } from '../../../supabase/functions/_shared/cleanup-runner';
import { createReferencePromotionService } from '@/server/assets/reference-promotion-service';

const userId = '10000000-0000-4000-8000-000000000001';
const taskId = '20000000-0000-4000-8000-000000000001';
const generationId = '30000000-0000-4000-8000-000000000001';
const requestId = '40000000-0000-4000-8000-000000000001';
const reference = { id: '50000000-0000-4000-8000-000000000001', name: 'reference.png', mimeType: 'image/png', size: 68 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=', 'base64');
function fixture(options: { denied?: string; guardDenied?: string; sourceSize?: number; reused?: boolean; prepareReused?: boolean; fail?: string; oversized?: boolean; corrupt?: boolean; abandonFails?: boolean; finalized?: boolean } = {}) {
  const sequence: string[] = [];
  const rpc = vi.fn(async (name: string, input?: Record<string, unknown>) => {
    const operation = name === 'promote_commerce_reference' ? (input?.p_metadata ? 'prepare' : 'lookup')
      : name === 'reference_write_intent' ? String(input?.p_operation) : name;
    sequence.push(operation);
    if (operation === 'lookup' && options.denied) return { data: null, error: { message: options.denied } };
    if (operation === 'reserve_preview_usage' && options.guardDenied) return { data: null, error: { message: options.guardDenied } };
    if (operation === options.fail || (operation === 'abandon' && options.abandonFails)) return { data: null, error: { message: 'unavailable' } };
    if (operation === 'lookup') return { data: options.reused ? { reference } : { sessionId: taskId, storagePath: 'private/generated.png', size: options.sourceSize ?? png.byteLength }, error: null };
    if (operation === 'prepare') {
      return { data: options.prepareReused ? { reference } : { referenceId: reference.id, storagePath: 'private/reference.png' }, error: null };
    }
    if (operation === 'finalize') return { data: reference, error: null };
    if (operation === 'abandon') return { data: { remove: !options.finalized }, error: null };
    return { data: true, error: null };
  });
  const download = vi.fn(async () => {
    sequence.push('download');
    return { data: new Blob([options.oversized ? new Uint8Array(10 * 1024 * 1024 + 1) : options.corrupt ? Buffer.from('<svg>not an image</svg>') : png], { type: 'image/png' }), error: null };
  });
  const upload = vi.fn(async () => { sequence.push('upload'); return { error: options.fail === 'upload' ? { message: 'failed' } : null }; });
  const remove = vi.fn(async () => { sequence.push('remove'); return { error: options.fail === 'remove' ? { message: 'failed' } : null }; });
  const from = vi.fn((bucket: string) => { expect(['generated', 'uploads']).toContain(bucket); return { download, upload, remove }; });
  const service = createReferencePromotionService({ rpc, storage: { from } });
  return { run: () => service.promote(userId, taskId, { requestId, generationId }, requestId), rpc, sequence, upload, download, remove };
}
describe('reference promotion', () => {
  it.each(['feature_disabled:upload', 'preview_quota_exceeded:upload_user_day'])('rejects %s before any source download', async guardDenied => {
    const f = fixture({ guardDenied });
    for (let attempt = 0; attempt < 3; attempt++) await expect(f.run()).rejects.toMatchObject({ status: guardDenied.startsWith('feature') ? 503 : 429 });
    expect(f.download).not.toHaveBeenCalled();
  });
  it.each(['reference_in_progress', 'reference_capacity_64'])('rejects %s lookup before downloading', async denied => {
    const f = fixture({ denied });
    await expect(f.run()).rejects.toMatchObject({ status: denied.includes('progress') ? 409 : 400 });
    expect(f.download).not.toHaveBeenCalled();
  });
  it('reserves trusted source size, without a blanket 10MiB charge', async () => {
    const f = fixture();
    await expect(f.run()).resolves.toEqual(reference);
    expect(f.rpc).toHaveBeenCalledWith('reserve_preview_usage', expect.objectContaining({ p_bytes: png.byteLength, p_operation: 'upload' }));
  });
  it('reconciles a smaller actual object before preparation without releasing admission', async () => {
    const f = fixture({ sourceSize: 1024 });
    await expect(f.run()).resolves.toEqual(reference);
    expect(f.rpc).toHaveBeenCalledWith('reconcile_reference_promotion_usage', expect.objectContaining({ p_bytes: png.byteLength, p_user_id: userId }));
    expect(f.sequence.indexOf('reconcile_reference_promotion_usage')).toBeLessThan(f.sequence.indexOf('prepare'));
  });
  it('rejects actual bytes exceeding their reserved server metadata bound', async () => {
    const f = fixture({ sourceSize: 1 });
    await expect(f.run()).rejects.toMatchObject({ status: 400 });
    expect(f.upload).not.toHaveBeenCalled();
  });
  it('does not upload when byte reconciliation fails', async () => {
    const f = fixture({ sourceSize: 1024, fail: 'reconcile_reference_promotion_usage' });
    await expect(f.run()).rejects.toMatchObject({ status: 503 });
    expect(f.upload).not.toHaveBeenCalled();
  });
  it('recognizes orphan_reference without changing cleanup claim shape', () => {
    expect(parseClaim({ attempt: 1, jobId: requestId, targetId: reference.id, claimToken: generationId,
      jobType: 'orphan_reference', objects: [{ bucket: 'uploads', path: 'private/reference.png' }] }))
      .toMatchObject({ jobType: 'orphan_reference', objects: [{ bucket: 'uploads', path: 'private/reference.png' }] });
  });
  it('rejects unsupported downloaded bytes despite a PNG content type', async () => {
    const f = fixture({ corrupt: true });
    await expect(f.run()).rejects.toMatchObject({ status: 400 });
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.sequence).not.toContain('prepare');
  });
  it.each(['task_not_found', 'source_not_found', 'unauthorized', 'source_not_succeeded', 'source_expired'])(
    'does no Storage work when database rejects %s', async denied => {
      const f = fixture({ denied });
      await expect(f.run()).rejects.toMatchObject({ status: denied.includes('expired') ? 410 : denied.includes('succeeded') ? 409 : 404 });
      expect(f.download).not.toHaveBeenCalled();
      expect(f.upload).not.toHaveBeenCalled();
      expect(f.rpc).toHaveBeenCalledWith('promote_commerce_reference', expect.objectContaining({ p_user_id: userId, p_task_id: taskId, p_generation_id: generationId, p_request_id: requestId }));
    },
  );
  it('reuses an active reference without reserving bytes or downloading', async () => {
    const f = fixture({ reused: true });
    await expect(f.run()).resolves.toEqual(reference);
    expect(f.sequence).toEqual(['lookup']);
  });
  it('rejects request/source conflicts before downloading', async () => {
    const f = fixture({ denied: 'idempotency_conflict' });
    await expect(f.run()).rejects.toMatchObject({ status: 409 });
    expect(f.download).not.toHaveBeenCalled();
  });
  it('rejects downloaded objects above 10MB before metadata or upload', async () => {
    const f = fixture({ oversized: true });
    await expect(f.run()).rejects.toMatchObject({ code: 'bad_request' });
    expect(f.sequence).toEqual(['lookup', 'reserve_preview_usage', 'download', 'release_preview_usage']);
  });
  it('reserves bytes, preregisters metadata AND intent, uploads, finalizes, then commits', async () => {
    const f = fixture();
    await expect(f.run()).resolves.toEqual(reference);
    expect(f.sequence).toEqual(['lookup', 'reserve_preview_usage', 'download', 'prepare', 'upload', 'finalize', 'commit_preview_usage']);
  });
  it('never uploads when preregistration fails', async () => {
    const f = fixture({ fail: 'prepare' });
    await expect(f.run()).rejects.toMatchObject({ status: 503 });
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.sequence.at(-1)).toBe('release_preview_usage');
  });
  it.each(['upload', 'finalize'])('durably abandons before object removal after %s failure', async fail => {
    const f = fixture({ fail });
    await expect(f.run()).rejects.toMatchObject({ status: 503 });
    expect(f.sequence.slice(-3)).toEqual(['abandon', 'remove', 'release_preview_usage']);
  });
  it('retains the byte reservation when compensation cannot confirm safety', async () => {
    const f = fixture({ fail: 'finalize', abandonFails: true });
    await expect(f.run()).rejects.toMatchObject({ status: 503 });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.sequence).not.toContain('release_preview_usage');
  });
  it('does not delete a finalized active object after a lost finalization response', async () => {
    const f = fixture({ fail: 'finalize', finalized: true });
    await expect(f.run()).rejects.toMatchObject({ status: 503 });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.sequence).not.toContain('release_preview_usage');
  });
  it('reuses the concurrent winner and releases its unused reservation', async () => {
    const f = fixture({ prepareReused: true });
    await expect(f.run()).resolves.toEqual(reference);
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.sequence.slice(-1)).toEqual(['release_preview_usage']);
  });
});
