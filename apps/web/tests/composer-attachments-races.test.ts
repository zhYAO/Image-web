import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadReference } from '@zimage/domain';

const cache = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), clear: vi.fn() }));
vi.mock('@/store/composer-attachments', () => ({
  loadAttachments: cache.load, saveAttachments: cache.save, clearAttachments: cache.clear,
}));
import { useWorkspaceStore } from '@/store/workspace-store';

describe('delayed attachment restoration', () => {
  let finish: (refs: UploadReference[]) => void;
  const restored = () => [{ name: 'restored.png', mimeType: 'image/png', size: 1, previewUrl: 'blob:restored' }];
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
    cache.load.mockImplementation(() => new Promise<UploadReference[]>((resolve) => { finish = resolve; }));
    URL.revokeObjectURL = vi.fn();
  });
  it('does not replace a newer selection with an older stored file', async () => {
    useWorkspaceStore.getState().activateComposer('A');
    expect(useWorkspaceStore.getState().restoringAttachments.A).toBe(true);
    useWorkspaceStore.getState().setReferences([{ name: 'new.png', mimeType: 'image/png', size: 1 }]);
    finish(restored());
    await vi.waitFor(() => expect(useWorkspaceStore.getState().restoringAttachments.A).toBe(false));
    expect(useWorkspaceStore.getState().references[0]?.name).toBe('new.png');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:restored');
  });
  it('finishes a previous session in its own cache after a session switch', async () => {
    useWorkspaceStore.getState().activateComposer('A');
    const finishA = finish;
    useWorkspaceStore.getState().activateComposer('B');
    finishA(restored());
    await vi.waitFor(() => expect(useWorkspaceStore.getState().composers.A?.references).toHaveLength(1));
    expect(useWorkspaceStore.getState().references).toEqual([]);
    useWorkspaceStore.getState().activateComposer('A');
    expect(useWorkspaceStore.getState().references[0]?.name).toBe('restored.png');
  });
  it('cannot repopulate another account after logout', async () => {
    useWorkspaceStore.getState().activateComposer('A');
    const finishA = finish;
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().activateComposer('B');
    finishA(restored());
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:restored'));
    expect(useWorkspaceStore.getState().references).toEqual([]);
    expect(useWorkspaceStore.getState().composers.A).toBeUndefined();
  });
  it('does not resurrect references after a clear or submission', async () => {
    useWorkspaceStore.getState().activateComposer('A');
    useWorkspaceStore.getState().setReferences([]);
    finish(restored());
    await vi.waitFor(() => expect(useWorkspaceStore.getState().restoringAttachments.A).toBe(false));
    expect(useWorkspaceStore.getState().references).toEqual([]);
  });
  it('does not restore a forgotten session', async () => {
    useWorkspaceStore.getState().activateComposer('deleted-during-read');
    useWorkspaceStore.getState().forgetComposer('deleted-during-read');
    finish(restored());
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:restored'));
    expect(useWorkspaceStore.getState().composers['deleted-during-read']).toBeUndefined();
    expect(cache.clear).toHaveBeenCalledWith('deleted-during-read');
  });
});
