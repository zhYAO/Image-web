import type { AspectRatio, ImageResolution, MockScenario, UploadReference } from '@zimage/domain';
import { create } from 'zustand';
import { clearComposer, loadComposer, saveComposer } from './composer-storage';
import { clearAttachments, loadAttachments, saveAttachments } from './composer-attachments';

let attachmentEpoch = 0;
const forgottenAttachments = new Set<string>();

interface WorkspaceSlice {
  activePopover?: 'image-settings' | 'image-model' | 'model' | 'skill';
  sidebarCollapsed: boolean;
  sessionDrawerOpen: boolean;
  configDrawerOpen: boolean;
  setActivePopover: (popover?: WorkspaceSlice['activePopover']) => void;
  setConfigDrawerOpen: (open: boolean) => void;
  setSessionDrawerOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export interface ComposerState {
  aspectRatio: AspectRatio;
  resolution: ImageResolution;
  count: number;
  selectedProvider?: string;
  selectedModelId?: string;
  selectedChatModel: string;
  skillPromptOverride?: string;
  references: UploadReference[];
  draft: string;
  explicitImageToolEnabled: boolean;
  selectedSkillId?: string;
  skillValues: Record<string, string>;
}

interface ComposerSlice extends ComposerState {
  restoringAttachments: Record<string, boolean>;
  activeComposerSessionId?: string;
  composers: Record<string, ComposerState>;
  activateComposer: (sessionId?: string, defaults?: Partial<ComposerState>, inheritCurrent?: boolean) => void;
  forgetComposer: (sessionId: string) => void;
  transferComposer: (from: string, to: string) => void;
  setAspectRatio: (value: AspectRatio) => void;
  setResolution: (value: ImageResolution) => void;
  setCount: (value: number) => void;
  setSelectedProvider: (value?: string) => void;
  setSelectedModelId: (value?: string) => void;
  setSelectedChatModel: (value: string) => void;
  setSkillPromptOverride: (value?: string) => void;
  setReferences: (value: UploadReference[] | ((current: UploadReference[]) => UploadReference[])) => void;
  setDraft: (value: string) => void;
  setExplicitImageToolEnabled: (enabled: boolean) => void;
  selectSkill: (skillId?: string) => void;
  setSkillValue: (key: string, value: string) => void;
}

interface CapabilitySlice {
  scenario: MockScenario;
  setScenario: (scenario: MockScenario) => void;
}

type WorkspaceUiState = WorkspaceSlice & ComposerSlice & CapabilitySlice & {
  reset: () => void;
};

const emptyComposer = (): ComposerState => ({
  draft: '', explicitImageToolEnabled: false, selectedSkillId: undefined, skillValues: {},
  aspectRatio: '1:1', resolution: '2K', count: 1, selectedChatModel: 'doubao',
  selectedProvider: undefined, selectedModelId: undefined, skillPromptOverride: undefined, references: [],
});
export const snapshotComposer = (state: ComposerState): ComposerState => Object.fromEntries(
  Object.keys(emptyComposer()).map((key) => [key, state[key as keyof ComposerState]]),
) as unknown as ComposerState;

const initialState = {
  activePopover: undefined,
  configDrawerOpen: false,
  draft: '',
  explicitImageToolEnabled: false,
  scenario: 'happy' as const,
  selectedSkillId: undefined,
  sessionDrawerOpen: false,
  sidebarCollapsed: false,
  skillValues: {},
};

export const useWorkspaceStore = create<WorkspaceUiState>((set) => ({
  ...initialState,
  ...emptyComposer(),
  composers: {},
  restoringAttachments: {},
  reset: () => { attachmentEpoch++; clearComposer(); void clearAttachments(); set({ ...initialState, ...emptyComposer(), composers: {}, restoringAttachments: {}, activeComposerSessionId: undefined }); },
  activateComposer: (sessionId, defaults, inheritCurrent = false) => set((state) => {
    if (sessionId === state.activeComposerSessionId) return {};
    const composers = { ...state.composers };
    if (state.activeComposerSessionId) composers[state.activeComposerSessionId] = snapshotComposer(state);
    else if (inheritCurrent && sessionId) composers[sessionId] = snapshotComposer(state);
    return { ...emptyComposer(), ...defaults, ...(sessionId ? loadComposer(sessionId) : undefined), ...composers[sessionId ?? ''], composers,
      count: 1, activeComposerSessionId: sessionId, activePopover: undefined, configDrawerOpen: false };
  }),
  forgetComposer: (sessionId) => set((state) => {
    forgottenAttachments.add(sessionId);
    void clearAttachments(sessionId);
    clearComposer(sessionId);
    const composers = { ...state.composers };
    delete composers[sessionId];
    return { composers, ...(state.activeComposerSessionId === sessionId
      ? { ...emptyComposer(), activeComposerSessionId: undefined } : {}) };
  }),
  transferComposer: (from, to) => set(state => {
    const source = state.activeComposerSessionId === from ? snapshotComposer(state) : state.composers[from];
    if (!source) return {};
    const composers = { ...state.composers, [to]: source };
    delete composers[from];
    saveComposer(to, source);
    void saveAttachments(to, source.references, 26);
    clearComposer(from);
    forgottenAttachments.add(from);
    void clearAttachments(from);
    return { composers, ...(state.activeComposerSessionId === from ? { activeComposerSessionId: to } : {}) };
  }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
  setResolution: (resolution) => set({ resolution }),
  setCount: (count) => set({ count }),
  setSelectedProvider: (selectedProvider) => set({ selectedProvider }),
  setSelectedModelId: (selectedModelId) => set({ selectedModelId }),
  setSelectedChatModel: (selectedChatModel) => set({ selectedChatModel }),
  setSkillPromptOverride: (skillPromptOverride) => set({ skillPromptOverride }),
  setReferences: (value) => set((state) => ({ references: typeof value === 'function' ? value(state.references) : value })),
  selectSkill: (selectedSkillId) =>
    set((state) => ({
      activePopover: selectedSkillId ? 'skill' : state.activePopover,
      selectedSkillId,
      skillValues: selectedSkillId === state.selectedSkillId ? state.skillValues : {},
    })),
  setConfigDrawerOpen: (configDrawerOpen) => set({ configDrawerOpen }),
  setActivePopover: (activePopover) => set({ activePopover }),
  setDraft: (draft) => set({ draft }),
  setExplicitImageToolEnabled: (explicitImageToolEnabled) => set({ explicitImageToolEnabled }),
  setScenario: (scenario) => set({ scenario }),
  setSessionDrawerOpen: (sessionDrawerOpen) => set({ sessionDrawerOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSkillValue: (key, value) =>
    set((state) => ({ skillValues: { ...state.skillValues, [key]: value } })),
}));

useWorkspaceStore.subscribe((state, previous) => {
  if (state.activeComposerSessionId) saveComposer(state.activeComposerSessionId, snapshotComposer(state));
  const sessionId = state.activeComposerSessionId;
  if (!sessionId) return;
  if (sessionId === previous.activeComposerSessionId) {
    if (state.references !== previous.references) void saveAttachments(sessionId, state.references, 26);
    return;
  }
  if (state.references.length) { void saveAttachments(sessionId, state.references, 26); return; }
  if (state.composers[sessionId] || forgottenAttachments.has(sessionId)) return;
  const initialReferences = state.references;
  const epoch = attachmentEpoch;
  useWorkspaceStore.setState({ restoringAttachments: { ...state.restoringAttachments, [sessionId]: true } });
  void loadAttachments(sessionId, 26).then((references) => {
    if (!references?.length) return;
    const current = useWorkspaceStore.getState();
    const active = current.activeComposerSessionId === sessionId;
    const composer = active ? current : current.composers[sessionId];
    // A delayed read must never restore attachments after removal, submission,
    // deletion, logout, or a newer edit. Session switches may finish in cache.
    if (epoch !== attachmentEpoch || forgottenAttachments.has(sessionId)
      || composer?.references !== initialReferences) {
      for (const ref of references) if (ref.previewUrl) URL.revokeObjectURL(ref.previewUrl);
      return;
    }
    useWorkspaceStore.setState(active ? { references } : {
      composers: { ...current.composers, [sessionId]: { ...composer, references } },
    });
  }).finally(() => {
    if (epoch !== attachmentEpoch) return;
    useWorkspaceStore.setState((current) => ({ restoringAttachments: { ...current.restoringAttachments, [sessionId]: false } }));
  });
});
