export type AdminClient = {
  auth: { admin: { deleteUser(userId: string): Promise<{ error: unknown }> } };
  rpc(name: string, input?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  storage: { from(bucket: string): { remove(paths: string[]): Promise<{ error: unknown }> } };
};

interface CleanupObject { bucket: 'generated' | 'uploads'; path: string }
export interface CleanupClaim {
  attempt: number;
  jobId: string;
  claimToken: string;
  jobType: 'orphan_reference' | 'orphan_result' | 'account_delete' | 'generation_expiry' | 'reference_expiry' | 'session_delete';
  objects: CleanupObject[];
  targetId: string;
}

export function parseClaim(value: unknown): CleanupClaim | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_cleanup_claim');
  const claim = value as Record<string, unknown>;
  const objects = Array.isArray(claim.objects) ? claim.objects.map((item): CleanupObject => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid_cleanup_object');
    const object = item as Record<string, unknown>;
    if ((object.bucket !== 'generated' && object.bucket !== 'uploads') || typeof object.path !== 'string') {
      throw new Error('invalid_cleanup_object');
    }
    return object as unknown as CleanupObject;
  }) : [];
  if (
    typeof claim.jobId !== 'string'
    || typeof claim.claimToken !== 'string'
    || typeof claim.targetId !== 'string'
    || !Number.isSafeInteger(claim.attempt)
    || !['orphan_reference', 'orphan_result', 'account_delete', 'generation_expiry', 'reference_expiry', 'session_delete'].includes(String(claim.jobType))
  ) throw new Error('invalid_cleanup_claim');
  return { ...claim, objects } as CleanupClaim;
}

async function rpc<T>(admin: AdminClient, name: string, input?: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, input);
  if (error) throw new Error(`rpc_failed:${name}`);
  return data as T;
}

class CleanupLeaseLost extends Error {}

export async function processCleanup(admin: AdminClient, claim: CleanupClaim) {
  let stopped = false;
  let renewing = false;
  const controller = new AbortController();
  const step = async (operation: string, code?: string) => {
    if (stopped) throw new CleanupLeaseLost();
    const result = await rpc<{ accepted: boolean; dead: boolean }>(admin, 'cleanup_worker_step', {
      p_job_id: claim.jobId, p_job_type: claim.jobType, p_claim_token: claim.claimToken,
      p_operation: operation, p_error_code: code ?? null,
    });
    if (stopped) throw new CleanupLeaseLost();
    if (!result.accepted) throw new CleanupLeaseLost();
    return result;
  };
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) throw new CleanupLeaseLost();
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new CleanupLeaseLost());
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([operation, cancelled]); }
    finally { controller.signal.removeEventListener('abort', abort); }
  };
  const timer = setInterval(() => {
    if (renewing || stopped) return;
    renewing = true;
    step('renew').catch(() => { stopped = true; controller.abort(); }).finally(() => { renewing = false; });
  }, 25_000);
  const deadline = setTimeout(() => { stopped = true; controller.abort(); }, 9 * 60_000);
  try {
    await bounded(step('renew'));
    for (const bucket of ['generated', 'uploads'] as const) {
      const paths = [...new Set(claim.objects.filter(object => object.bucket === bucket).map(object => object.path))];
      for (let offset = 0; offset < paths.length; offset += 100) {
        await bounded(step('renew'));
        const { error } = await bounded(admin.storage.from(bucket).remove(paths.slice(offset, offset + 100)));
        if (error) throw new Error('storage_cleanup_failed');
      }
    }
    if (claim.jobType === 'account_delete') {
      await bounded(step('renew'));
      const { error } = await bounded(admin.auth.admin.deleteUser(claim.targetId));
      // A delete response can be lost; Auth's subsequent user_not_found is success.
      if (error && !(typeof error === 'object' && 'code' in error && error.code === 'user_not_found')) {
        throw new Error('auth_user_cleanup_failed');
      }
    }
    await bounded(step('complete'));
    return { action: 'completed' };
  } catch (error) {
    if (error instanceof CleanupLeaseLost) return { action: 'stale' };
    try {
      const result = await bounded(step('fail', error instanceof Error ? error.message : 'cleanup_failed'));
      return { action: result.dead ? 'dead' : 'retry' };
    } catch (failure) {
      if (failure instanceof CleanupLeaseLost) return { action: 'stale' };
      // Even an unavailable failure RPC is recoverable by lease expiration.
      return { action: 'retry' };
    }
  } finally {
    clearInterval(timer); clearTimeout(deadline); stopped = true; controller.abort();
  }
}
