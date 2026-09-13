import type { ErrorTimelineItem, MessageTimelineItem, TimelineItem } from '@zimage/domain';
import { describe, expect, it } from 'vitest';
import { chatRecoveryActions, reconcileChatTimeline, type FailedChatAttempt } from '@/features/workspace/chat-recovery';

const user: MessageTimelineItem = { type: 'message', role: 'user', id: 'local-user', sessionId: 'session-a', sequence: 1, createdAt: '2026-09-09', content: '同一句问题' };
const error: ErrorTimelineItem = { type: 'error', id: 'local-error', sessionId: 'session-a', sequence: 3, createdAt: '2026-09-09', error: { code: 'PROVIDER_UNAVAILABLE', message: '服务暂不可用', retryable: true } };
const attempt: FailedChatAttempt = { user, error, knownItemIds: [], request: { sessionId: 'session-a', chatModel: 'doubao', message: user.content, imageToolEnabled: false } };
const persistedUser = { ...user, id: 'saved-user' };
const persistedError = { ...error, id: 'saved-error' };

describe('chat error reconciliation', () => {
  it('maps a saved user without a saved error and keeps that mapping on later same-text turns', () => {
    const partial: MessageTimelineItem = { ...user, id: 'partial', role: 'assistant', content: '部分回复' };
    const first = reconcileChatTimeline([persistedUser], [user, partial, error], [{ ...attempt, assistantId: partial.id }]);
    expect(first.timeline.map((item) => item.id)).toEqual(['saved-user', 'partial', 'local-error']);
    expect(first.chatFailures[0]?.persistedUserId).toBe('saved-user');
    const second = reconcileChatTimeline([persistedUser, { ...persistedUser, id: 'later-user', sequence: 4 }], first.retainedItems, first.chatFailures);
    expect(second.timeline.map((item) => item.id)).toEqual(['saved-user', 'partial', 'local-error', 'later-user']);
    expect(second.chatFailures[0]?.persistedUserId).toBe('saved-user');
  });

  it('can attach a late persisted error to an already mapped user', () => {
    const first = reconcileChatTimeline([persistedUser], [user, error], [attempt]);
    const next = reconcileChatTimeline([persistedUser, persistedError], first.retainedItems, first.chatFailures);
    expect(next.timeline.map((item) => item.id)).toEqual(['saved-user', 'saved-error']);
    expect(next.chatFailures[0]?.persistedErrorId).toBe('saved-error');
  });

  it('replaces only this turn error and keeps partial text absent from server history', () => {
    const partial: MessageTimelineItem = { ...user, id: 'assistant-stream-id', role: 'assistant', sequence: 2, content: '收到的部分回复' };
    const result = reconcileChatTimeline([persistedUser, persistedError], [user, partial, error], [{ ...attempt, assistantId: partial.id }]);
    expect(result.timeline.map((item) => item.id)).toEqual(['saved-user', 'assistant-stream-id', 'saved-error']);
    expect(chatRecoveryActions(result.timeline, result.chatFailures)['saved-error']).toMatchObject({ label: '重试', prompt: '同一句问题', attempt: { request: { chatModel: 'doubao' } } });
  });

  it('deduplicates partial text by the SSE message identity, not by its content', () => {
    const partial: MessageTimelineItem = { ...user, id: 'assistant-stream-id', role: 'assistant', content: '部分回复' };
    const result = reconcileChatTimeline([persistedUser, partial, persistedError], [user, partial, error], [{ ...attempt, assistantId: partial.id }]);
    expect(result.timeline.map((item) => item.id)).toEqual(['saved-user', 'assistant-stream-id', 'saved-error']);
  });

  it('does not confuse a previous identical failure with the current unsaved request', () => {
    const previous: TimelineItem[] = [persistedUser, persistedError];
    const result = reconcileChatTimeline(previous, [user, error], [{ ...attempt, knownItemIds: ['saved-user', 'saved-error'] }]);
    expect(result.timeline.map((item) => item.id)).toEqual(['saved-user', 'saved-error', 'local-user', 'local-error']);
  });

  it('keeps local evidence when concurrent same-text turns make server association ambiguous', () => {
    const result = reconcileChatTimeline([persistedUser, persistedError, { ...persistedUser, id: 'other-user' }], [user, error], [attempt]);
    expect(result.retainedItems).toEqual([user, error]);
  });

  it('offers editing after reload instead of resending with an invented model snapshot', () => {
    expect(chatRecoveryActions([persistedUser, persistedError], [])['saved-error']).toEqual({ label: '重新编辑', prompt: '同一句问题' });
  });

  it('does not offer retries for non-retryable errors or consumed attempts', () => {
    expect(chatRecoveryActions([user, { ...error, error: { ...error.error, retryable: false } }], [attempt])).toEqual({});
    expect(chatRecoveryActions([user, error], [{ ...attempt, retried: true }])).toEqual({});
    expect(chatRecoveryActions([error], [])).toEqual({});
  });
  it('does not guess which same-text local attempt owns a persisted failure', () => {
    const retry: FailedChatAttempt = {
      ...attempt, user: { ...user, id: 'retry-user' }, error: { ...error, id: 'retry-error' },
      knownItemIds: ['local-user', 'local-error'],
    };
    const result = reconcileChatTimeline([persistedUser, persistedError], [user, error, retry.user, retry.error], [{ ...attempt, retried: true }, retry]);
    expect(result.timeline.map((item) => item.id)).toEqual(['local-user', 'local-error', 'retry-user', 'retry-error', 'saved-user', 'saved-error']);
    expect(result.chatFailures[0]?.persistedErrorId).toBeUndefined();
    expect(result.chatFailures[1]?.persistedErrorId).toBeUndefined();
    expect(chatRecoveryActions(result.timeline, result.chatFailures)['saved-error']?.label).toBe('重新编辑');
    expect(chatRecoveryActions(result.timeline, result.chatFailures)['retry-error']?.label).toBe('重试');
  });

  it('resolves competing attempts when the server includes the exact SSE assistant identity', () => {
    const partial: MessageTimelineItem = { ...user, id: 'retry-assistant', role: 'assistant', content: '部分回复' };
    const retry: FailedChatAttempt = { ...attempt, user: { ...user, id: 'retry-user' }, error: { ...error, id: 'retry-error' }, assistantId: partial.id };
    const result = reconcileChatTimeline([persistedUser, partial, persistedError], [user, error, retry.user, partial, retry.error], [{ ...attempt, retried: true }, retry]);
    expect(result.chatFailures[0]?.persistedErrorId).toBeUndefined();
    expect(result.chatFailures[1]?.persistedErrorId).toBe('saved-error');
    expect(result.timeline.map((item) => item.id)).toEqual(['local-user', 'local-error', 'saved-user', 'retry-assistant', 'saved-error']);
  });

});
