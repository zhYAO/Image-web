import type { ComposerMode, MockScenario } from '@zimage/domain';
import { create } from 'zustand';

interface WorkspaceUiState {
  mode: ComposerMode;
  drafts: Record<ComposerMode, string>;
  explicitImageToolEnabled: boolean;
  selectedSkillId?: string;
  skillValues: Record<string, string>;
  scenario: MockScenario;
  sessionDrawerOpen: boolean;
  configDrawerOpen: boolean;
  setMode: (mode: ComposerMode) => void;
  setDraft: (mode: ComposerMode, value: string) => void;
  setExplicitImageToolEnabled: (enabled: boolean) => void;
  selectSkill: (skillId?: string) => void;
  setSkillValue: (key: string, value: string) => void;
  setScenario: (scenario: MockScenario) => void;
  setSessionDrawerOpen: (open: boolean) => void;
  setConfigDrawerOpen: (open: boolean) => void;
  reset: () => void;
}

const initialState = {
  configDrawerOpen: false,
  drafts: { chat: '', image: '' },
  explicitImageToolEnabled: false,
  mode: 'chat' as const,
  scenario: 'happy' as const,
  selectedSkillId: undefined,
  sessionDrawerOpen: false,
  skillValues: {},
};

export const useWorkspaceStore = create<WorkspaceUiState>((set) => ({
  ...initialState,
  reset: () => set({ ...initialState, drafts: { ...initialState.drafts }, skillValues: {} }),
  selectSkill: (selectedSkillId) =>
    set((state) => ({
      mode: selectedSkillId ? 'image' : state.mode,
      selectedSkillId,
      skillValues: selectedSkillId ? {} : state.skillValues,
    })),
  setConfigDrawerOpen: (configDrawerOpen) => set({ configDrawerOpen }),
  setDraft: (mode, value) => set((state) => ({ drafts: { ...state.drafts, [mode]: value } })),
  setExplicitImageToolEnabled: (explicitImageToolEnabled) => set({ explicitImageToolEnabled }),
  setMode: (mode) => set({ mode }),
  setScenario: (scenario) => set({ scenario }),
  setSessionDrawerOpen: (sessionDrawerOpen) => set({ sessionDrawerOpen }),
  setSkillValue: (key, value) =>
    set((state) => ({ skillValues: { ...state.skillValues, [key]: value } })),
}));
