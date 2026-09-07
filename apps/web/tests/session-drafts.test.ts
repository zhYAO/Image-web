import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '@/store/workspace-store';

describe('session composer ownership', () => {
  beforeEach(() => useWorkspaceStore.getState().reset());
  it('starts a new session empty and restores the previous session draft and settings', () => {
    const store = useWorkspaceStore.getState;
    store().activateComposer('A');
    store().setDraft('A draft');
    store().setExplicitImageToolEnabled(true);
    store().setCount(4);
    store().activateComposer('B');
    expect(store()).toMatchObject({ draft: '', explicitImageToolEnabled: false, count: 2 });
    store().setDraft('B draft');
    store().activateComposer('A');
    expect(store()).toMatchObject({ draft: 'A draft', explicitImageToolEnabled: true, count: 4 });
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
});
