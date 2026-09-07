import { withSupabase } from '@supabase/server';

import { captureWorkerException } from '../_shared/sentry.ts';

type AdminClient = {
  auth: { admin: { deleteUser(userId: string): Promise<{ error: unknown }> } };
  rpc(name: string, input?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  storage: { from(bucket: string): { remove(paths: string[]): Promise<{ error: unknown }> } };
};

interface CleanupObject { bucket: 'generated' | 'uploads'; path: string }
interface CleanupClaim {
  attempt: number;
  jobId: string;
  jobType: 'account_delete' | 'generation_expiry' | 'reference_expiry' | 'session_delete';
  objects: CleanupObject[];
  targetId: string;
}

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

function parseClaim(value: unknown): CleanupClaim | null {
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
    (claim.jobType !== 'account_delete' && typeof claim.jobId !== 'string')
    || typeof claim.targetId !== 'string'
    || !Number.isSafeInteger(claim.attempt)
    || !['account_delete', 'generation_expiry', 'reference_expiry', 'session_delete'].includes(String(claim.jobType))
  ) throw new Error('invalid_cleanup_claim');
  return { ...claim, objects } as CleanupClaim;
}

async function rpc<T>(admin: AdminClient, name: string, input?: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, input);
  if (error) throw new Error(`rpc_failed:${name}`);
  return data as T;
}

async function removeObjects(admin: AdminClient, objects: CleanupObject[]) {
  for (const bucket of ['generated', 'uploads'] as const) {
    const paths = [...new Set(objects.filter((object) => object.bucket === bucket).map((object) => object.path))];
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100));
      if (error) throw new Error('storage_cleanup_failed');
    }
  }
}

export default {
  fetch: withSupabase({ auth: ['secret'] }, async (request, context) => {
    if (request.headers.get('x-worker-secret') !== requiredEnvironment('ZIMAGE_WORKER_CRON_SECRET')) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const admin = context.supabaseAdmin as unknown as AdminClient;
    await rpc<unknown>(admin, 'prune_preview_usage');
    const claim = parseClaim(await rpc<unknown>(admin, 'claim_cleanup_job'))
      ?? parseClaim(await rpc<unknown>(admin, 'claim_account_cleanup_job'));
    if (!claim) return Response.json({ status: 'idle' });
    try {
      await removeObjects(admin, claim.objects);
      let completed: boolean;
      if (claim.jobType === 'account_delete') {
        const { error } = await admin.auth.admin.deleteUser(claim.targetId);
        if (error) throw new Error('auth_user_cleanup_failed');
        // Deleting auth.users cascades the account cleanup row and all owned business rows.
        completed = true;
      } else {
        completed = await rpc<boolean>(admin, 'complete_cleanup_job', { p_job_id: claim.jobId });
      }
      if (!completed) throw new Error('cleanup_state_conflict');
      console.log(JSON.stringify({ action: 'completed', jobId: claim.jobId, jobType: claim.jobType }));
      return Response.json({ action: 'completed', jobType: claim.jobType });
    } catch (error: unknown) {
      await captureWorkerException(error, { jobId: claim.jobId, operation: 'cleanup_worker' });
      const result = await rpc<{ attempts: number; dead: boolean }>(admin,
        claim.jobType === 'account_delete' ? 'fail_account_cleanup_job' : 'fail_cleanup_job', {
        p_error_code: error instanceof Error ? error.message : 'cleanup_failed',
        ...(claim.jobType === 'account_delete' ? { p_user_id: claim.targetId } : { p_job_id: claim.jobId }),
      });
      console.error(JSON.stringify({
        action: result.dead ? 'dead' : 'retry', attempts: result.attempts, jobId: claim.jobId, jobType: claim.jobType,
      }));
      return Response.json({ action: result.dead ? 'dead' : 'retry' }, { status: 503 });
    }
  }),
};
