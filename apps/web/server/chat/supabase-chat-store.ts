import { sessionSchema, type Session } from '@zimage/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { ApiRouteError } from '@/server/api-error';

const startResultSchema = z.strictObject({
  created: z.boolean(),
  session: sessionSchema,
});

function persistenceFailure() {
  return new ApiRouteError({
    code: 'network',
    message: '聊天记录暂时无法保存，请稍后重试。',
    retryable: true,
    status: 503,
  });
}

export class SupabaseChatStore {
  constructor(private readonly admin: SupabaseClient) {}

  async start(input: { message: string; sessionId?: string; userId: string }): Promise<{
    created: boolean;
    session: Session;
  }> {
    const { data, error } = await this.admin.rpc('start_chat_turn', {
      p_message: input.message,
      p_session_id: input.sessionId ?? null,
      p_user_id: input.userId,
    });
    if (error || !data) {
      if (`${error?.code ?? ''} ${error?.message ?? ''}`.includes('session_not_found')) {
        throw new ApiRouteError({
          code: 'not_found', message: '会话不存在或无权访问。', retryable: false, status: 404,
        });
      }
      throw persistenceFailure();
    }
    return startResultSchema.parse(data);
  }

  async complete(input: { content: string; sessionId: string; userId: string }) {
    const { data, error } = await this.admin.rpc('complete_chat_turn', {
      p_content: input.content,
      p_session_id: input.sessionId,
      p_user_id: input.userId,
    });
    const parsed = z.uuid().safeParse(data);
    if (error || !parsed.success) throw persistenceFailure();
    return parsed.data;
  }

  async recordProviderResult(provider: string, isError: boolean) {
    const { error } = await this.admin.rpc('record_chat_provider_result', {
      p_is_error: isError,
      p_provider: provider,
    });
    if (error) throw persistenceFailure();
  }

  async history(sessionId: string) {
    const { data, error } = await this.admin
      .from('timeline_items')
      .select('role,text')
      .eq('session_id', sessionId)
      .eq('kind', 'message')
      .order('sequence', { ascending: false })
      .limit(20);
    if (error) throw persistenceFailure();
    return (data ?? []).reverse().flatMap((item) => (
      (item.role === 'assistant' || item.role === 'user') && typeof item.text === 'string'
        ? [{ content: item.text, role: item.role }]
        : []
    ));
  }

  async assertProviderAvailable(provider: string) {
    const { data, error } = await this.admin.rpc('assert_chat_provider_available', { p_provider: provider });
    if (error) throw persistenceFailure();
    if (data !== true) {
      throw new ApiRouteError({
        code: 'provider_error',
        message: '所选聊天服务暂时不可用，请选择其他 provider。',
        retryable: true,
        status: 503,
      });
    }
  }
}
