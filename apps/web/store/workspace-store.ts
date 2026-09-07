import type { AspectRatio, ImageResolution, MockScenario, UploadReference } from '@zimage/domain';
import { create } from 'zustand';

interface WorkspaceSlice {
  activePopover?: 'image-settings' | 'model' | 'skill';
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
  activeComposerSessionId?: string;
  composers: Record<string, ComposerState>;
  activateComposer: (sessionId?: string, defaults?: Partial<ComposerState>) => void;
  forgetComposer: (sessionId: string) => void;
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
  aspectRatio: '1:1', resolution: '2K', count: 2, selectedChatModel: 'doubao',
  selectedProvider: undefined, selectedModelId: undefined, skillPromptOverride: undefined, references: [],
});
const snapshot = (state: ComposerState): ComposerState => Object.fromEntries(
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
  reset: () => set({ ...initialState, ...emptyComposer(), composers: {}, activeComposerSessionId: undefined }),
  activateComposer: (sessionId, defaults) => set((state) => {
    if (sessionId === state.activeComposerSessionId) return {};
    const composers = { ...state.composers };
    if (state.activeComposerSessionId) composers[state.activeComposerSessionId] = snapshot(state);
    return { ...emptyComposer(), ...defaults, ...composers[sessionId ?? ''], composers,
      activeComposerSessionId: sessionId, activePopover: undefined, configDrawerOpen: false };
  }),
  forgetComposer: (sessionId) => set((state) => {
    const composers = { ...state.composers };
    delete composers[sessionId];
    return { composers, ...(state.activeComposerSessionId === sessionId
      ? { ...emptyComposer(), activeComposerSessionId: undefined } : {}) };
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
