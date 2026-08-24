import { sessionSchema, type Session } from '@zimage/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { ApiRouteError } from '@/server/api-error';

import type { SessionDeletionResult, SessionStore } from './session-service';

const sessionRowSchema = z.object({
  created_at: z.iso.datetime(),
  id: z.uuid(),
  status: z.enum(['active', 'deleting']),
  title: z.string(),
  updated_at: z.iso.datetime(),
});

const sessionColumns = 'id,title,status,created_at,updated_at';

function toSession(input: unknown): Session {
  const row = sessionRowSchema.parse(input);
  return sessionSchema.parse({
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
    const { data, error } = await this.userClient
      .from('sessions')
      .select(sessionColumns)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false });
    if (error) throw databaseFailure('会话列表暂时不可用，请稍后重试。');
    return (data ?? []).map(toSession);
  }

  async create(userId: string, title: string) {
    if (!this.adminClient) throw databaseFailure('暂时无法创建会话，请稍后重试。');
    const { data, error } = await this.adminClient
      .from('sessions')
      .insert({ title, user_id: userId })
      .select(sessionColumns)
      .single();
    if (error || !data) throw databaseFailure('暂时无法创建会话，请稍后重试。');
    return toSession(data);
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
