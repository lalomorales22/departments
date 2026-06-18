'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RubricCategory, UserRole } from '@departments/shared';

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

export const SETTINGS_TABS = ['DEFAULTS', 'GATES', 'MEMBERS', 'BILLING', 'INTEGRATIONS'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

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

  /** Import-Artifact (⌘I) modal — opens on the ARTIFACTS tab. */
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;
  /** Jump to ARTIFACTS and open the import modal (⌘I / command palette / quick action). */
  openImport: () => void;

  /** Stub focus targets for chords whose panels are not built yet. */
  mapFocused: boolean;
  setMapFocused: (v: boolean) => void;

  /**
   * Client-side loop config overrides (cadence edited in the Inspector). The engine/DB
   * owns the durable value in prod; this reflects an in-session edit optimistically.
   */
  loopCadence: Record<string, string>;
  setLoopCadence: (loopId: string, cadence: string) => void;

  /**
   * The acting user's role (multi-role UI). The gateway is authoritative server-side;
   * this drives client-side capability gating + the role switcher (RBAC_MATRIX). In
   * prod it's hydrated from the session; the switcher lets a demo preview each role.
   */
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;

  /**
   * Per-loop gate-threshold overrides (the Inspector / SETTINGS sliders). 0–100 per
   * category; absent ⇒ the engine default. Optimistic client edits; the durable write
   * is the engine/DB path.
   */
  gateThresholds: Record<string, Partial<Record<RubricCategory, number>>>;
  setGateThreshold: (loopId: string, category: RubricCategory, value: number) => void;

  /** Active SETTINGS sub-tab. */
  settingsTab: SettingsTab;
  setSettingsTab: (t: SettingsTab) => void;
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

      leftCollapsed: false,
      rightCollapsed: false,
      toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
      toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),

      commandOpen: false,
      setCommandOpen: (open) => set({ commandOpen: open }),
      shortcutSheetOpen: false,
      setShortcutSheetOpen: (open) => set({ shortcutSheetOpen: open }),

      importOpen: false,
      setImportOpen: (open) => set({ importOpen: open }),
      openImport: () => set({ activeTab: 'ARTIFACTS', importOpen: true, commandOpen: false }),

      mapFocused: false,
      setMapFocused: (v) => set({ mapFocused: v }),

      loopCadence: {},
      setLoopCadence: (loopId, cadence) =>
        set((s) => ({ loopCadence: { ...s.loopCadence, [loopId]: cadence } })),

      userRole: 'commander',
      setUserRole: (role) => set({ userRole: role }),

      gateThresholds: {},
      setGateThreshold: (loopId, category, value) =>
        set((s) => ({
          gateThresholds: {
            ...s.gateThresholds,
            [loopId]: { ...s.gateThresholds[loopId], [category]: value },
          },
        })),

      settingsTab: 'GATES',
      setSettingsTab: (t) => set({ settingsTab: t }),
    }),
    {
      name: 'departments-cockpit',
      partialize: (s) => ({
        leftCollapsed: s.leftCollapsed,
        rightCollapsed: s.rightCollapsed,
        logTab: s.logTab,
        inspectorTab: s.inspectorTab,
        userRole: s.userRole,
        gateThresholds: s.gateThresholds,
      }),
    },
  ),
);
