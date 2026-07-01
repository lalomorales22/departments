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

/**
 * Two navigation modes (Phase 8 IA). ORG = the six top tabs aggregate across ALL loops
 * (a whole-org mega-dashboard); LOOP = a single selected loop's dedicated workspace page.
 * Clicking a loop in the hierarchy enters LOOP view; a breadcrumb returns to ORG.
 */
export type ViewMode = 'org' | 'loop';

export const SETTINGS_TABS = ['PROVIDER', 'DEFAULTS', 'GATES', 'MEMBERS', 'BILLING', 'INTEGRATIONS'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Which model backend actually drives a loop's cognition. */
export type AiProvider = 'ollama' | 'claude';

/** The orchestrator roles the engine drives — each can run its own local model. */
export const ORCHESTRATOR_ROLES = ['planner', 'executor', 'reviewer', 'docs'] as const;
export type OrchestratorRole = (typeof ORCHESTRATOR_ROLES)[number];

/** The provider selection sent with every run + shown as the cockpit's model badge. */
export interface ProviderConfig {
  provider: AiProvider;
  /** Ollama daemon base URL. */
  ollamaBaseUrl: string;
  /** The default Ollama model — used for any role without an explicit override. */
  ollamaModel: string;
  /** Per-role Ollama model overrides; empty value ⇒ use the default model for that role. */
  ollamaRoleModels: Record<OrchestratorRole, string>;
  /** Anthropic API key (local-only; sent to the same-origin run route, never persisted server-side). */
  anthropicApiKey: string;
  /** Optional pinned Claude model id; empty ⇒ per-role tiering. */
  claudeModel: string;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: '',
  ollamaRoleModels: { planner: '', executor: '', reviewer: '', docs: '' },
  anthropicApiKey: '',
  claudeModel: '',
};

interface CockpitState {
  /**
   * ORG (whole-org aggregate tabs) vs LOOP (a single loop's workspace). Clicking a loop
   * enters LOOP view; the breadcrumb / back-to-org returns to ORG.
   */
  viewMode: ViewMode;
  /** Open a loop's dedicated workspace (selects it + switches to LOOP view). */
  enterLoop: (id: string) => void;
  /** Return to the whole-org view (keeps the loop selected for context). */
  backToOrg: () => void;

  /** Currently focused loop (drives the per-loop workspace + inspector). */
  selectedLoopId: string;
  setSelectedLoop: (id: string) => void;

  /** Agent scoping: selecting an agent filters the log console + highlights tasks. */
  selectedAgentId: string | null;
  setSelectedAgent: (id: string | null) => void;

  activeTab: Tab;
  setTab: (tab: Tab) => void;

  logTab: LogTab;
  setLogTab: (t: LogTab) => void;

  /** Panel collapse (persisted). */
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;

  /** Right inspector width in px (persisted, drag-resizable + clamped). */
  rightWidth: number;
  setRightWidth: (px: number) => void;

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

  /**
   * Dedicated creation modals (Phase 8): ⌘N New Loop, ⌘A New Agent, ⌘T New Task — each
   * opens its OWN modal instead of falling through to the ⌘K search window. Agent/Task are
   * scoped to a loop, so opening them also carries the loop they target.
   */
  newLoopOpen: boolean;
  setNewLoopOpen: (open: boolean) => void;
  newAgentOpen: boolean;
  setNewAgentOpen: (open: boolean) => void;
  newTaskOpen: boolean;
  setNewTaskOpen: (open: boolean) => void;

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

  /**
   * The AI provider + model that drives loop cognition. Persisted locally and sent with
   * every run so the spawned engine uses the chosen backend (local Ollama or Claude). The
   * API key lives only in this local store + the same-origin run request — never on a server.
   */
  providerConfig: ProviderConfig;
  setProviderConfig: (patch: Partial<ProviderConfig>) => void;
}

export const useCockpit = create<CockpitState>()(
  persist(
    (set) => ({
      // The whole-org dashboard is the landing view; clicking a loop enters its workspace.
      viewMode: 'org',
      enterLoop: (id) => set({ selectedLoopId: id, viewMode: 'loop', selectedAgentId: null }),
      backToOrg: () => set({ viewMode: 'org' }),

      // Empty until the loop registry hydrates from the DB (then the first loop, or a
      // freshly created one, is selected). No fixture id is assumed. setSelectedLoop does
      // NOT switch view (used to keep a valid selection while staying in ORG); enterLoop does.
      selectedLoopId: '',
      setSelectedLoop: (id) => set({ selectedLoopId: id, selectedAgentId: null }),

      selectedAgentId: null,
      setSelectedAgent: (id) =>
        set((s) => ({ selectedAgentId: s.selectedAgentId === id ? null : id })),

      activeTab: 'DASHBOARD',
      // The six tabs ARE the org lens — selecting one always shows the whole-org aggregate,
      // returning from any loop workspace you'd drilled into.
      setTab: (tab) => set({ activeTab: tab, viewMode: 'org' }),

      logTab: 'LOGS',
      setLogTab: (t) => set({ logTab: t }),

      leftCollapsed: false,
      rightCollapsed: false,
      toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
      toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),

      rightWidth: 344,
      setRightWidth: (px) => set({ rightWidth: Math.max(280, Math.min(560, Math.round(px))) }),

      commandOpen: false,
      setCommandOpen: (open) => set({ commandOpen: open }),
      shortcutSheetOpen: false,
      setShortcutSheetOpen: (open) => set({ shortcutSheetOpen: open }),

      importOpen: false,
      setImportOpen: (open) => set({ importOpen: open }),
      openImport: () => set({ activeTab: 'ARTIFACTS', viewMode: 'org', importOpen: true, commandOpen: false }),

      newLoopOpen: false,
      setNewLoopOpen: (open) => set({ newLoopOpen: open, commandOpen: false }),
      newAgentOpen: false,
      setNewAgentOpen: (open) => set({ newAgentOpen: open, commandOpen: false }),
      newTaskOpen: false,
      setNewTaskOpen: (open) => set({ newTaskOpen: open, commandOpen: false }),

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

      settingsTab: 'PROVIDER',
      setSettingsTab: (t) => set({ settingsTab: t }),

      providerConfig: DEFAULT_PROVIDER_CONFIG,
      setProviderConfig: (patch) => set((s) => ({ providerConfig: { ...s.providerConfig, ...patch } })),
    }),
    {
      name: 'departments-cockpit',
      partialize: (s) => ({
        viewMode: s.viewMode,
        selectedLoopId: s.selectedLoopId,
        leftCollapsed: s.leftCollapsed,
        rightCollapsed: s.rightCollapsed,
        rightWidth: s.rightWidth,
        logTab: s.logTab,
        userRole: s.userRole,
        gateThresholds: s.gateThresholds,
        providerConfig: s.providerConfig,
      }),
      // Deep-merge persisted state over defaults so a config saved BEFORE a field existed
      // (e.g. `ollamaRoleModels`) is backfilled instead of replacing the whole object —
      // otherwise an old localStorage entry leaves nested fields undefined and crashes.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CockpitState>;
        return {
          ...current,
          ...p,
          providerConfig: {
            ...DEFAULT_PROVIDER_CONFIG,
            ...(p.providerConfig ?? {}),
            ollamaRoleModels: {
              ...DEFAULT_PROVIDER_CONFIG.ollamaRoleModels,
              ...(p.providerConfig?.ollamaRoleModels ?? {}),
            },
          },
        };
      },
    },
  ),
);
