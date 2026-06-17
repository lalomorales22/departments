'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const TABS = [
  'DASHBOARD',
  'AGENTS',
  'TASKS',
  'ARTIFACTS',
  'ANALYTICS',
  'SETTINGS',
] as const;
export type Tab = (typeof TABS)[number];

export type LogTab = 'LOGS' | 'DEBUG' | 'OUTPUT';
export type InspectorTab = 'DETAILS' | 'CONFIG' | 'HISTORY';

interface CockpitState {
  /** Currently focused loop (drives center + inspector). */
  selectedLoopId: string;
  setSelectedLoop: (id: string) => void;

  /** Agent scoping: selecting an agent filters the log console + highlights tasks. */
  selectedAgentId: string | null;
  setSelectedAgent: (id: string | null) => void;

  activeTab: Tab;
  setTab: (tab: Tab) => void;

  logTab: LogTab;
  setLogTab: (t: LogTab) => void;

  inspectorTab: InspectorTab;
  setInspectorTab: (t: InspectorTab) => void;

  /** Pipeline auto-progress vs manual single-step (engine wired in Phase 3). */
  pipelineAutoLayout: boolean;
  toggleAutoLayout: () => void;

  /** Panel collapse (persisted). */
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;

  /** Command palette / search (cmdk) + shortcut sheet. */
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  shortcutSheetOpen: boolean;
  setShortcutSheetOpen: (open: boolean) => void;

  /** Stub focus targets for chords whose panels are not built yet. */
  mapFocused: boolean;
  setMapFocused: (v: boolean) => void;
}

export const useCockpit = create<CockpitState>()(
  persist(
    (set) => ({
      selectedLoopId: 'loop-marketing',
      setSelectedLoop: (id) => set({ selectedLoopId: id, selectedAgentId: null }),

      selectedAgentId: null,
      setSelectedAgent: (id) =>
        set((s) => ({ selectedAgentId: s.selectedAgentId === id ? null : id })),

      activeTab: 'DASHBOARD',
      setTab: (tab) => set({ activeTab: tab }),

      logTab: 'LOGS',
      setLogTab: (t) => set({ logTab: t }),

      inspectorTab: 'DETAILS',
      setInspectorTab: (t) => set({ inspectorTab: t }),

      pipelineAutoLayout: true,
      toggleAutoLayout: () => set((s) => ({ pipelineAutoLayout: !s.pipelineAutoLayout })),

      leftCollapsed: false,
      rightCollapsed: false,
      toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
      toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),

      commandOpen: false,
      setCommandOpen: (open) => set({ commandOpen: open }),
      shortcutSheetOpen: false,
      setShortcutSheetOpen: (open) => set({ shortcutSheetOpen: open }),

      mapFocused: false,
      setMapFocused: (v) => set({ mapFocused: v }),
    }),
    {
      name: 'departments-cockpit',
      partialize: (s) => ({
        leftCollapsed: s.leftCollapsed,
        rightCollapsed: s.rightCollapsed,
        pipelineAutoLayout: s.pipelineAutoLayout,
        logTab: s.logTab,
        inspectorTab: s.inspectorTab,
      }),
    },
  ),
);
