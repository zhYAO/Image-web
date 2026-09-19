import {
  createSessionRequestSchema,
  renameSessionRequestSchema,
  type CreateSessionRequest,
  type DeleteSessionResponse,
  type RenameSessionRequest,
  type Session,
} from '@zimage/domain';
import { z } from 'zod';

import { ApiRouteError } from '@/server/api-error';

export type SessionDeletionResult = 'accepted' | 'already_deleting' | 'not_found';

export interface SessionStore {
  create(userId: string, title: string, requestId?: string): Promise<Session>;
  list(userId: string): Promise<Session[]>;
  rename(userId: string, sessionId: string, title: string): Promise<Session>;
  requestDeletion(userId: string, sessionId: string): Promise<SessionDeletionResult>;
}

function parseUserId(userId: string) {
  return z.uuid().parse(userId);
}

function parseSessionId(sessionId: string) {
  return z.uuid().parse(sessionId);
}

export function createSessionService(store: SessionStore) {
  return {
    async list(userId: string) {
      return { sessions: await store.list(parseUserId(userId)) };
    },

    async create(userId: string, input: CreateSessionRequest) {
      const request = createSessionRequestSchema.parse(input);
      const session = await store.create(parseUserId(userId), request.title ?? '新的创作', request.requestId);
      return { session };
    },

    async rename(userId: string, sessionId: string, input: RenameSessionRequest) {
      const request = renameSessionRequestSchema.parse(input);
      const session = await store.rename(parseUserId(userId), parseSessionId(sessionId), request.title);
      return { session };
    },

    async remove(userId: string, sessionId: string): Promise<DeleteSessionResponse> {
      const parsedSessionId = parseSessionId(sessionId);
      const result = await store.requestDeletion(parseUserId(userId), parsedSessionId);
      if (result === 'already_deleting') {
        throw new ApiRouteError({
          code: 'session_deleting',
          message: '会话正在删除中，请勿重复提交。',
          retryable: false,
          status: 409,
        });
      }
      if (result === 'not_found') {
        throw new ApiRouteError({
          code: 'not_found',
          message: '会话不存在或无权访问。',
          retryable: false,
          status: 404,
        });
      }
      return { sessionId: parsedSessionId, status: 'deleting' };
    },
  };
}
