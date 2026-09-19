import { sessionSchema, type Session } from '@zimage/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { ApiRouteError } from '@/server/api-error';

import type { SessionDeletionResult, SessionStore } from './session-service';

const sessionRowSchema = z.object({
  activity_types: sessionSchema.shape.activityTypes,
  created_at: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  status: z.enum(['active', 'deleting']),
  title: z.string(),
  updated_at: z.iso.datetime({ offset: true }),
});

const sessionColumns = 'id,title,status,created_at,updated_at';

function toSession(input: unknown): Session {
  const row = sessionRowSchema.parse(input);
  return sessionSchema.parse({
    activityTypes: row.activity_types,
    createdAt: row.created_at,
    id: row.id,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  });
}

function databaseFailure(message: string) {
  return new ApiRouteError({
    code: 'network',
    message,
    retryable: true,
    status: 503,
  });
}

export class SupabaseSessionStore implements SessionStore {
  constructor(
    private readonly userClient: SupabaseClient,
    private readonly adminClient?: SupabaseClient,
  ) {}

  async list(userId: string) {
    const { data, error } = await this.userClient.rpc('list_sessions_with_activity', { p_user_id: userId });
    // Migration rollout is independent from the web deployment. Only an absent
    // summary function may use the previous projection; all other errors surface.
    if (error?.code === 'PGRST202' || (error?.code === '42883' && error.message.includes('list_sessions_with_activity'))) {
      const legacy = await this.userClient
        .from('sessions')
        .select(sessionColumns)
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false });
      if (legacy.error) throw databaseFailure('会话列表暂时不可用，请稍后重试。');
      const sessions = (legacy.data ?? []).map(toSession);
      return this.fillMissingActivity(userId, sessions);
    }
    if (error) throw databaseFailure('会话列表暂时不可用，请稍后重试。');
    return this.fillMissingActivity(userId, (data ?? []).map(toSession));
  }

  private async fillMissingActivity(userId: string, sessions: Session[]) {
    const missing = sessions.filter(session => !session.activityTypes?.length);
    if (!missing.length) return sessions;
    const commerce = await this.userClient.from('commerce_tasks').select('session_id')
      .eq('user_id', userId).in('session_id', missing.map(session => session.id));
    if (commerce.error) throw databaseFailure('会话类型暂时无法核验，请稍后重试。');
    const ids = new Set((commerce.data ?? []).map(row => row.session_id));
    return sessions.map(session => session.activityTypes?.length ? session : {
      ...session, activityTypes: [ids.has(session.id) ? 'commerce' : 'chat'] as Session['activityTypes'],
    });
  }

  async create(userId: string, title: string, requestId?: string) {
    if (!this.adminClient) throw databaseFailure('暂时无法创建会话，请稍后重试。');
    if (requestId) {
      // The existing primary key is the replay identity; never overwrite another owner or revive a deleting session.
      const inserted = await this.adminClient.from('sessions').upsert(
        { id: requestId, title, user_id: userId }, { onConflict: 'id', ignoreDuplicates: true },
      );
      if (inserted.error) throw databaseFailure('暂时无法创建会话，请稍后重试。');
      const result = await this.userClient.from('sessions').select(sessionColumns)
        .eq('id', requestId).eq('user_id', userId).eq('status', 'active').maybeSingle();
      if (result.error || !result.data) throw databaseFailure('会话不存在或暂时无法恢复。');
      return toSession({ ...result.data, activity_types: ['chat'] });
    }
    const { data, error } = await this.adminClient
      .from('sessions')
      .insert({ title, user_id: userId })
      .select(sessionColumns)
      .single();
    if (error || !data) throw databaseFailure('暂时无法创建会话，请稍后重试。');
    return toSession({ ...data, activity_types: ['chat'] });
  }

  async rename(userId: string, sessionId: string, title: string) {
    if (!this.adminClient) throw databaseFailure('暂时无法重命名会话，请稍后重试。');
    const { data, error } = await this.adminClient
      .from('sessions')
      .update({ title })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .select(sessionColumns)
      .maybeSingle();
    if (error) throw databaseFailure('暂时无法重命名会话，请稍后重试。');
    if (!data) {
      throw new ApiRouteError({
        code: 'not_found',
        message: '会话不存在或无权访问。',
        retryable: false,
        status: 404,
      });
    }
    return toSession(data);
  }

  async requestDeletion(userId: string, sessionId: string): Promise<SessionDeletionResult> {
    if (!this.adminClient) throw databaseFailure('删除服务暂时不可用，请稍后重试。');
    const { data, error } = await this.adminClient.rpc('request_session_deletion', {
      p_session_id: sessionId,
      p_user_id: userId,
    });
    if (error || !['accepted', 'already_deleting', 'not_found'].includes(String(data))) {
      throw databaseFailure('暂时无法删除会话，请稍后重试。');
    }
    return data as SessionDeletionResult;
  }
}
