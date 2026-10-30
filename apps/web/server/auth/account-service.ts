import type { Account } from '../../../../packages/domain/src/auth-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiRouteError } from '../api-error';
import { requireVerifiedUserId } from '../route-context';

type ProfileClient = SupabaseClient & { from(table: string): {
  select(columns: string): { eq(column: string, value: string): { single(): Promise<{ data: unknown; error: unknown }> } };
  update(value: unknown): { eq(column: string, value: string): { select(columns: string): { single(): Promise<{ data: unknown; error: unknown }> } } };
} };

export async function readAccount(client: SupabaseClient): Promise<Account> {
  const id = await requireVerifiedUserId(client);
  const [{ data: userData, error: userError }, profileResult] = await Promise.all([
    client.auth.getUser(),
    (client as ProfileClient).from('account_profiles').select('display_name,status').eq('user_id', id).single(),
  ]).catch(() => { throw unavailable(); });
  const profile = profileResult.data as { display_name: string | null; status: 'active' | 'deleting' } | null;
  if (userError || !userData.user?.email || userData.user.id !== id || profileResult.error || !profile) throw unavailable();
  return { id, email: userData.user.email, displayName: profile.display_name, status: profile.status };
}

export async function updateDisplayName(client: SupabaseClient, displayName: string | null): Promise<Account> {
  const id = await requireVerifiedUserId(client);
  const normalized = displayName === '' ? null : displayName;
  const { error } = await (client as ProfileClient).from('account_profiles').update({ display_name: normalized }).eq('user_id', id).select('user_id').single();
  if (error) throw unavailable();
  return readAccount(client);
}

function unavailable() { return new ApiRouteError({ code: 'network', message: '账号服务暂时不可用，请稍后重试。', retryable: true, status: 503 }); }
