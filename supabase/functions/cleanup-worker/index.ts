import { withSupabase } from '@supabase/server';
import { captureWorkerException } from '../_shared/sentry.ts';
import { parseClaim, processCleanup, type AdminClient } from '../_shared/cleanup-runner.ts';

function requiredEnvironment(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

export default {
  fetch: withSupabase({ auth: ['secret'] }, async (request, context) => {
    if (request.headers.get('x-worker-secret') !== requiredEnvironment('ZIMAGE_WORKER_CRON_SECRET')) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const admin = context.supabaseAdmin as unknown as AdminClient;
    try {
      const pruned = await admin.rpc('prune_preview_usage');
      if (pruned.error) throw new Error('preview_prune_failed');
      const { data, error } = await admin.rpc('claim_cleanup_work');
      if (error) throw new Error('cleanup_claim_failed');
      const claim = parseClaim(data);
      if (!claim) return Response.json({ status: 'idle' });
      const result = await processCleanup(admin, claim);
      console.log(JSON.stringify({ ...result, jobId: claim.jobId, jobType: claim.jobType }));
      return Response.json(result, { status: result.action === 'retry' || result.action === 'dead' ? 503 : 200 });
    } catch (error) {
      await captureWorkerException(error, { operation: 'cleanup_worker' });
      return Response.json({ error: 'cleanup_worker_failed' }, { status: 503 });
    }
  }),
};
