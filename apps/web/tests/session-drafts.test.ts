import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '@/store/workspace-store';
import { lastComposerSession, loadComposer } from '@/store/composer-storage';

describe('session composer ownership', () => {
  beforeEach(() => useWorkspaceStore.getState().reset());
  it('binds the first submission to a session without resetting image settings', () => {
    const store = useWorkspaceStore.getState;
    store().setExplicitImageToolEnabled(true);
    store().setCount(4);
    store().selectSkill('white-background');
    store().activateComposer('first', {}, true);
    expect(store()).toMatchObject({ activeComposerSessionId: 'first', explicitImageToolEnabled: true, count: 1, selectedSkillId: 'white-background' });
    store().activateComposer('second');
    expect(store()).toMatchObject({ explicitImageToolEnabled: false, count: 1, selectedSkillId: undefined });
  });
  it('starts a new session empty and restores the previous session draft and settings', () => {
    const store = useWorkspaceStore.getState;
    store().activateComposer('A');
    store().setDraft('A draft');
    store().setExplicitImageToolEnabled(true);
    store().setCount(4);
    store().activateComposer('B');
    expect(store()).toMatchObject({ draft: '', explicitImageToolEnabled: false, count: 1 });
    store().setDraft('B draft');
    store().activateComposer('A');
    expect(store()).toMatchObject({ draft: 'A draft', explicitImageToolEnabled: true, count: 1 });
  });
  it('isolates references and Skill choices and clears all content on account reset', () => {
    const store = useWorkspaceStore.getState;
    store().activateComposer('A');
    store().selectSkill('white-background');
    store().setReferences([{ name: 'A.png', mimeType: 'image/png', size: 2 }]);
    store().activateComposer('B');
    expect(store().references).toEqual([]);
    expect(store().selectedSkillId).toBeUndefined();
    store().activateComposer('A');
    expect(store().references[0]?.name).toBe('A.png');
    store().reset();
    store().activateComposer('A');
    expect(store().references).toEqual([]);
    expect(store().selectedSkillId).toBeUndefined();
  });
  it('restores a server-selected session after a page reload without restoring file handles', () => {
    const store = useWorkspaceStore.getState;
    store().activateComposer('reload');
    store().setDraft('unsent product prompt');
    store().setSelectedChatModel('doubao');
    store().setCount(3);
    store().setReferences([{ name: 'local.png', size: 2, mimeType: 'image/png', previewUrl: 'blob:old-document' }]);
    expect(lastComposerSession(['reload'])).toBe('reload');
    expect(lastComposerSession(['other-user-session'])).toBeUndefined();
    useWorkspaceStore.setState({ activeComposerSessionId: undefined, composers: {}, draft: '', references: [] });
    store().activateComposer('different-account-session');
    expect(store().draft).toBe('');
    store().activateComposer('reload');
    expect(store()).toMatchObject({ draft: 'unsent product prompt', selectedChatModel: 'doubao', count: 1, references: [] });
  });
  it('clears saved drafts when an account resets or a session is forgotten', () => {
    const store = useWorkspaceStore.getState;
    store().activateComposer('deleted');
    store().setDraft('private');
    store().forgetComposer('deleted');
    expect(loadComposer('deleted')).toBeUndefined();
    store().activateComposer('logout');
    store().setDraft('private');
    store().reset();
    expect(loadComposer('logout')).toBeUndefined();
  });
  it('ignores corrupt and expired saved state', () => {
    sessionStorage.setItem('zimage:composer:v1:corrupt', '{');
    sessionStorage.setItem('zimage:composer:v1:expired', JSON.stringify({ savedAt: 0, draft: { draft: 'old' } }));
    expect(loadComposer('corrupt')).toBeUndefined();
    expect(loadComposer('expired')).toBeUndefined();
  });
});
