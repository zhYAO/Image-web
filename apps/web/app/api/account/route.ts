import { accountPatchSchema, credentialsSchema } from '../../../../../packages/domain/src/auth-contracts';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { readAccount, updateDisplayName } from '../../../server/auth/account-service';
import { authPost } from '../../../server/auth/http';
import { assertTrustedOrigin, executeRoute, requireVerifiedUserId } from '../../../server/route-context';

export function GET() { return executeRoute(async () => Response.json(await readAccount(await createSupabaseServerClient()))); }
export const PATCH = authPost(accountPatchSchema, async ({ displayName }) => updateDisplayName(await createSupabaseServerClient(), displayName));
export const DELETE = authPost(credentialsSchema.pick({ password: true }).extend({ confirmation: z.literal('DELETE') }), async ({ password }, request) => {
  assertTrustedOrigin(request);
  const client = await createSupabaseServerClient();
  await requireVerifiedUserId(client);
  const { error } = await client.auth.signInWithPassword({ email: (await client.auth.getUser()).data.user?.email ?? '', password });
  if (error) return { accepted: false };
  const deletion = await client.rpc('request_account_deletion' as never);
  if (deletion.error) throw deletion.error;
  await client.auth.signOut({ scope: 'local' });
  return { accepted: true, status: 'deleting' };
});
