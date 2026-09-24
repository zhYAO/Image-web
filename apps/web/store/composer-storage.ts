import type { ComposerState } from './workspace-store';

const PREFIX = 'zimage:composer:v1:';
const ACTIVE = 'zimage:active-composer:v1';
const MAX_AGE = 24 * 60 * 60 * 1000;

/** Tab-local drafts are restored only after the server authorizes the session.
 * File bytes are cached separately in IndexedDB; never persist object URLs.
 */
export function saveComposer(sessionId: string, state: ComposerState) {
  try {
    const draft = { ...state, references: undefined };
    window.sessionStorage.setItem(PREFIX + sessionId, JSON.stringify({ savedAt: Date.now(), draft }));
    window.sessionStorage.setItem(ACTIVE, sessionId);
  } catch { /* Storage restrictions must not prevent editing or submission. */ }
}

export function lastComposerSession(authorizedSessionIds: string[]): string | undefined {
  try {
    const id = window.sessionStorage.getItem(ACTIVE);
    return id && authorizedSessionIds.includes(id) ? id : undefined;
  } catch { return; }
}

export function loadComposer(sessionId: string): Partial<ComposerState> | undefined {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + sessionId);
    if (!raw) return;
    const { savedAt, draft } = JSON.parse(raw);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > MAX_AGE || !draft || typeof draft !== 'object') return;
    if (typeof draft.draft !== 'string' || draft.draft.length > 100_000
      || typeof draft.explicitImageToolEnabled !== 'boolean'
      || !['1:1', '3:4', '4:3', '9:16', '16:9'].includes(draft.aspectRatio)
      || !['1K', '2K'].includes(draft.resolution)
      || !Number.isInteger(draft.count) || draft.count < 1 || draft.count > 4
      || !['doubao', 'minimax'].includes(draft.selectedChatModel)) return;
    // Whitelist fields: stored data cannot introduce actions or attachment URLs.
    return {
      draft: draft.draft, explicitImageToolEnabled: draft.explicitImageToolEnabled,
      aspectRatio: draft.aspectRatio, resolution: draft.resolution, count: 1,
      selectedChatModel: draft.selectedChatModel,
      selectedProvider: typeof draft.selectedProvider === 'string' ? draft.selectedProvider : undefined,
      selectedModelId: typeof draft.selectedModelId === 'string' ? draft.selectedModelId : undefined,
    };
  } catch { return; }
}

export function clearComposer(sessionId?: string) {
  try {
    if (!sessionId || window.sessionStorage.getItem(ACTIVE) === sessionId) window.sessionStorage.removeItem(ACTIVE);
    if (sessionId) window.sessionStorage.removeItem(PREFIX + sessionId);
    else for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch { /* Storage may be disabled. */ }
}
