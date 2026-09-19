import { withSupabase } from '@supabase/server';
import { captureWorkerException } from '../_shared/sentry.ts';
import { parseClaim, processClaim, type AdminClient } from '../_shared/generation-runner.ts';

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

async function rpc<T>(admin: AdminClient, name: string, input?: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, input);
  if (error) throw new Error(`rpc_failed:${name}`);
  return data as T;
}

export default {
  fetch: withSupabase({ auth: ['secret'] }, async (request, context) => {
    if (request.headers.get('x-worker-secret') !== env('ZIMAGE_WORKER_CRON_SECRET')) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = context.supabaseAdmin as unknown as AdminClient;
    let correlationId: string | undefined;
    let generationId: string | undefined;
    try {
      const claim = parseClaim(await rpc<unknown>(admin, 'claim_image_generation'));
      if (!claim) return Response.json({ status: 'idle' });

      if (claim.action === 'archive') {
        await rpc(admin, 'archive_image_message', { p_message_id: claim.messageId });
        return Response.json({ action: 'archived', reason: claim.reason });
      }
      if (claim.action !== 'process' && claim.action !== 'recover') throw new Error('invalid_queue_action');

      correlationId = claim.correlationId;
      generationId = claim.generationId;
      const result = await processClaim(admin, claim);
      console.log(JSON.stringify({
        action: result.action,
        batchId: claim.batchId,
        code: 'code' in result ? result.code : undefined,
        correlationId,
        generationId,
        provider: claim.provider,
      }));
      return Response.json(result);
    } catch (error: unknown) {
      await captureWorkerException(error, {
        correlationId,
        jobId: generationId,
        operation: 'generation_worker',
      });
      return Response.json({ error: 'generation_worker_failed' }, { status: 500 });
    }
  }),
};
