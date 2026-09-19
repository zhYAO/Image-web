import type { Session } from '@zimage/domain';

export type SessionCategory = 'general' | 'commerce' | 'unknown';
export function sessionCategory(session: Session, hasDraft = false): SessionCategory {
  if (hasDraft || session.activityTypes?.some(type => type === 'commerce' || type === 'poster')) return 'commerce';
  return session.activityTypes?.length ? 'general' : 'unknown';
}

/** Mutation projections omit activity metadata; never erase a known summary. */
export function mergeSessionActivity(next: Session[], previous: Session[]): Session[] {
  const old = new Map(previous.map(session => [session.id, session]));
  return next.map(session => ({ ...session, activityTypes: session.activityTypes ?? old.get(session.id)?.activityTypes }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
