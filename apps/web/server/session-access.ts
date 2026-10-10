import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiRouteError } from './api-error';

// The caller must derive userId from requireVerifiedUserId, including when this
// query uses an admin client that bypasses row-level security.
export async function assertActiveBusinessSession(
  client: SupabaseClient,
  userId: string,
  sessionId: string,
) {
  const { data, error } = await client.from('sessions').select('id')
    .eq('id', sessionId).eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (error || !data) {
    throw new ApiRouteError({
      code: 'not_found', status: 404, retryable: false,
      message: '会话不存在或无权访问。',
    });
  }
}
