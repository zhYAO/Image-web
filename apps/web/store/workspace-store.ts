import type { MockScenario } from '@zimage/domain';
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

interface ComposerSlice {
  draft: string;
  explicitImageToolEnabled: boolean;
  selectedSkillId?: string;
  skillValues: Record<string, string>;
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
  reset: () => set({ ...initialState, skillValues: {} }),
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
