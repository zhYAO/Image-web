import type { ChatRequest, ErrorTimelineItem, MessageTimelineItem, TimelineItem } from '@zimage/domain';

// Request snapshots stay in this session's UI runtime, never in persisted/API data.
export interface FailedChatAttempt {
  request: ChatRequest;
  user: MessageTimelineItem;
  error: ErrorTimelineItem;
  knownItemIds: string[];
  persistedErrorId?: string;
  persistedUserId?: string;
  assistantId?: string;
  retried?: boolean;
}

function turnAfterUser(items: TimelineItem[], attempt: FailedChatAttempt, matchedUser: TimelineItem, claimedErrors: Set<string>) {
  const known = new Set(attempt.knownItemIds);
  const start = items.findIndex((item) => item.id === matchedUser.id);
  const following = items.slice(start + 1);
  const boundary = following.findIndex((item) => item.type === 'generation' || (item.type === 'message' && item.role === 'user'));
  const turn = boundary < 0 ? following : following.slice(0, boundary);
  const errors = turn.filter((item): item is ErrorTimelineItem => item.type === 'error'
    && !claimedErrors.has(item.id) && !known.has(item.id) && item.error.code === attempt.error.error.code
    && item.error.message === attempt.error.error.message);
  const assistantMatches = turn.some((item) => item.id === attempt.assistantId);
  return { user: matchedUser, error: errors.length === 1 ? errors[0] : undefined, assistantMatches };
}

function persistedTurn(items: TimelineItem[], attempt: FailedChatAttempt, claimedUsers: Set<string>, claimedErrors: Set<string>) {
  const known = new Set(attempt.knownItemIds);
  const users = items.filter((item) => item.type === 'message' && item.role === 'user'
    && !claimedUsers.has(item.id) && item.sessionId === attempt.user.sessionId && !known.has(item.id) && item.content === attempt.request.message && item.id !== attempt.user.id);
  // The server persists the user before starting the stream, but does not
  // persist stream failures. A unique user match must not require an error row.
  // Multiple same-text candidates still have no provable ownership.
  if (users.length !== 1 || !users[0]) return undefined;
  return turnAfterUser(items, attempt, users[0], claimedErrors);
}

export function reconcileChatTimeline(saved: TimelineItem[], retained: TimelineItem[], failures: FailedChatAttempt[]) {
  const replaced = new Set(saved.map((item) => item.id));
  const claimedUsers = new Set<string>();
  const claimedErrors = new Set<string>();
  const matches: Array<{ user?: TimelineItem; error?: ErrorTimelineItem } | undefined> = failures.map((attempt) => {
    const error = saved.find((item): item is ErrorTimelineItem => item.type === 'error' && item.id === attempt.persistedErrorId);
    const user = saved.find((item) => item.id === attempt.persistedUserId);
    if (!error && !user) return undefined;
    const matchedError = error ?? (user ? turnAfterUser(saved, attempt, user, claimedErrors).error : undefined);
    if (matchedError) claimedErrors.add(matchedError.id);
    if (user) claimedUsers.add(user.id);
    return { user, error: matchedError };
  });
  // Stable mappings win. Identical unmapped attempts need unique ownership
  // or an SSE identity; request order alone cannot prove which turn persisted.
  const candidates = failures.map((attempt, index) => matches[index] ? undefined
    : persistedTurn(saved, attempt, claimedUsers, claimedErrors));
  candidates.forEach((turn, index) => {
    if (!turn) return;
    const competing = candidates.filter((candidate) => candidate?.user.id === turn.user.id);
    const identified = competing.filter((candidate) => candidate?.assistantMatches);
    if (competing.length > 1 && !(turn.assistantMatches && identified.length === 1)) return;
    matches[index] = turn;
  });
  const nextFailures = failures.map((attempt, index) => {
    const match = matches[index];
    if (!match) return attempt;
    if (match.user) replaced.add(attempt.user.id);
    if (match.error) replaced.add(attempt.error.id);
    return { ...attempt, persistedUserId: match.user?.id ?? attempt.persistedUserId, persistedErrorId: match.error?.id ?? attempt.persistedErrorId };
  });
  const retainedItems = retained.filter((item) => !replaced.has(item.id));
  const timeline = [...saved];
  for (const item of retainedItems) {
    const attempt = nextFailures.find((failure) => failure.assistantId === item.id || failure.user.id === item.id || failure.error.id === item.id);
    if (!attempt) { timeline.push(item); continue; }
    const errorIndex = item.id === attempt.assistantId && attempt.persistedErrorId
      ? timeline.findIndex((entry) => entry.id === attempt.persistedErrorId) : -1;
    if (errorIndex >= 0) { timeline.splice(errorIndex, 0, item); continue; }
    const userIndex = timeline.findIndex((entry) => entry.id === attempt.persistedUserId);
    if (userIndex >= 0) {
      const nextTurn = timeline.findIndex((entry, index) => index > userIndex && (entry.type === 'generation' || (entry.type === 'message' && entry.role === 'user')));
      timeline.splice(nextTurn < 0 ? timeline.length : nextTurn, 0, item);
    } else {
      const anchors = new Set([...attempt.knownItemIds, attempt.user.id, attempt.assistantId]);
      const anchor = timeline.reduce((last, entry, index) => anchors.has(entry.id) ? index : last, -1);
      timeline.splice(anchor + 1, 0, item);
    }
  }
  return { timeline, retainedItems, chatFailures: nextFailures };
}

export function chatRecoveryActions(items: TimelineItem[], failures: FailedChatAttempt[]) {
  const actions: Record<string, { label: string; attempt?: FailedChatAttempt; prompt: string }> = {};
  let prompt: string | undefined;
  for (const item of items) {
    if (item.type === 'generation') prompt = undefined;
    if (item.type === 'message' && item.role === 'user') prompt = item.content;
    if (item.type !== 'error' || !item.error.retryable) continue;
    const attempt = failures.find((failure) => failure.error.id === item.id || failure.persistedErrorId === item.id);
    if (attempt) {
      if (!attempt.retried) actions[item.id] = { label: '重试', attempt, prompt: attempt.request.message };
    } else if (prompt) {
      // Reloaded histories do not carry the original model snapshot. Restore
      // text for explicit review instead of silently choosing a different model.
      actions[item.id] = { label: '重新编辑', prompt };
    }
  }
  return actions;
}
