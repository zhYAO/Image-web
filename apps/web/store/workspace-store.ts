import type { ComposerMode, MockScenario } from '@zimage/domain';
import { create } from 'zustand';

interface WorkspaceSlice {
  activePopover?: 'model' | 'parameters' | 'skill';
  sidebarCollapsed: boolean;
  sessionDrawerOpen: boolean;
  configDrawerOpen: boolean;
  setActivePopover: (popover?: WorkspaceSlice['activePopover']) => void;
  setConfigDrawerOpen: (open: boolean) => void;
  setSessionDrawerOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

interface ComposerSlice {
  mode: ComposerMode;
  drafts: Record<ComposerMode, string>;
  explicitImageToolEnabled: boolean;
  selectedSkillId?: string;
  skillValues: Record<string, string>;
  setMode: (mode: ComposerMode) => void;
  setDraft: (mode: ComposerMode, value: string) => void;
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

const initialState = {
  activePopover: undefined,
  configDrawerOpen: false,
  drafts: { chat: '', image: '' },
  explicitImageToolEnabled: false,
  mode: 'chat' as const,
  scenario: 'happy' as const,
  selectedSkillId: undefined,
  sessionDrawerOpen: false,
  sidebarCollapsed: false,
  skillValues: {},
};

export const useWorkspaceStore = create<WorkspaceUiState>((set) => ({
  ...initialState,
  reset: () => set({ ...initialState, drafts: { ...initialState.drafts }, skillValues: {} }),
  selectSkill: (selectedSkillId) =>
    set((state) => ({
      activePopover: selectedSkillId ? 'skill' : state.activePopover,
      selectedSkillId,
      skillValues: selectedSkillId === state.selectedSkillId ? state.skillValues : {},
    })),
  setConfigDrawerOpen: (configDrawerOpen) => set({ configDrawerOpen }),
  setActivePopover: (activePopover) => set({ activePopover }),
  setDraft: (mode, value) => set((state) => ({ drafts: { ...state.drafts, [mode]: value } })),
  setExplicitImageToolEnabled: (explicitImageToolEnabled) => set({ explicitImageToolEnabled }),
  setMode: (mode) => set({ mode }),
  setScenario: (scenario) => set({ scenario }),
  setSessionDrawerOpen: (sessionDrawerOpen) => set({ sessionDrawerOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSkillValue: (key, value) =>
    set((state) => ({ skillValues: { ...state.skillValues, [key]: value } })),
}));
