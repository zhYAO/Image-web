import { describe, expect, it, vi } from 'vitest';
import { parseClaim, processCleanup, type CleanupClaim } from '../_shared/cleanup-runner';
const claim: CleanupClaim = { attempt: 1, jobId: 'job', targetId: 'user', jobType: 'account_delete',
  claimToken: 'token', objects: [{ bucket: 'generated', path: 'user/session/result.png' }] };
function fixture() {
  let token = 'token'; let accountExists = true; let failures = 0;
  const objects = new Set(['user/session/result.png']);
  const remove = vi.fn(async (paths: string[]) => { paths.forEach(p => objects.delete(p)); return { error: null }; });
  const admin = {
    auth: { admin: { deleteUser: vi.fn(async () => { accountExists = false; return { error: null }; }) } },
    storage: { from: () => ({ remove }) },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      if (name !== 'cleanup_worker_step') return { data: true, error: null };
      if (args.p_claim_token !== token) return { data: { accepted: false, dead: false }, error: null };
      if (args.p_operation === 'fail') failures++;
      return { data: { accepted: true, dead: false }, error: null };
    },
  };
  return { admin, remove, objects, get accountExists() { return accountExists; },
    get failures() { return failures; }, reclaim: () => { token = 'new-token'; } };
}
describe('cleanup worker fencing and compensation', () => {
  it('rejects a stale claim before deleting objects or the account', async () => {
    const f = fixture(); f.reclaim();
    expect(await processCleanup(f.admin, claim)).toMatchObject({ action: 'stale' });
    expect(f.accountExists).toBe(true); expect(f.objects.size).toBe(1);
  });
  it('checks the lease again between storage removal and Auth deletion', async () => {
    const f = fixture(); f.remove.mockImplementation(async paths => { paths.forEach(p => f.objects.delete(p)); f.reclaim(); return { error: null }; });
    expect(await processCleanup(f.admin, claim)).toMatchObject({ action: 'stale' });
    expect(f.accountExists).toBe(true);
  });
  it('persists cleanup failure for a reclaim instead of losing the claimed job', async () => {
    const f = fixture(); f.remove.mockRejectedValue(new Error('storage_down'));
    expect(await processCleanup(f.admin, claim)).toMatchObject({ action: 'retry' });
    expect(f.failures).toBe(1); expect(f.accountExists).toBe(true);
  });
  it('idempotently removes a late upload when its retained tombstone is reclaimed', async () => {
    const f = fixture(); const orphan: CleanupClaim = { ...claim, jobType: 'orphan_result' };
    await processCleanup(f.admin, orphan);
    expect(f.objects.size).toBe(0);
    f.objects.add('user/session/result.png');
    await processCleanup(f.admin, orphan);
    expect(f.objects.size).toBe(0); expect(f.accountExists).toBe(true);
  });
  it('accepts apparel tombstone claims and removes delayed layout writes without Auth deletion',async()=>{
    const f=fixture(),apparel={...claim,jobType:'orphan_apparel' as const};
    expect(parseClaim(apparel)).toMatchObject({jobType:'orphan_apparel'});
    await processCleanup(f.admin,apparel);f.objects.add('user/session/result.png');
    await processCleanup(f.admin,apparel);expect(f.objects.size).toBe(0);expect(f.accountExists).toBe(true);
  });
});
