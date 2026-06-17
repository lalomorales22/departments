/**
 * THE single status→color map. Every status dot, badge, glow, sparkline stroke, and
 * pipeline accent resolves through here. Nothing else in the app may decide a color
 * from a status. Hex values live only in `globals.css :root`; this map references
 * them via `var(--accent-*)`, so "no inlined hex anywhere" stays true.
 */
import type {
  AgentStatus,
  LoopStatus,
  Phase,
  RubricCategory,
  TaskPriority,
  TaskState,
} from '@departments/shared';
import { type AccentKey, accentForPhase } from '@departments/shared';

/** Resolve a semantic accent key to its CSS custom-property reference. */
export function accentVar(key: AccentKey): string {
  return `var(--accent-${key})`;
}

/** Resolve a semantic accent key to its glow box-shadow custom property. */
export function glowVar(key: AccentKey): string {
  return `var(--glow-${key})`;
}

/** Tailwind text-color class for an accent (e.g. `text-accent-cyan`). */
export function accentTextClass(key: AccentKey): string {
  return `text-accent-${key}`;
}

/** Tailwind background-color class for an accent. */
export function accentBgClass(key: AccentKey): string {
  return `bg-accent-${key}`;
}

// ─── Status → accent key mappings ─────────────────────────────────────────────

export const loopStatusAccent: Record<LoopStatus, AccentKey> = {
  running: 'green',
  idle: 'blue',
  paused: 'amber',
  stopped: 'red',
  error: 'red',
};

export const agentStatusAccent: Record<AgentStatus, AccentKey> = {
  running: 'green',
  idle: 'blue',
  blocked: 'amber',
  error: 'red',
};

export const priorityAccent: Record<TaskPriority, AccentKey> = {
  P1: 'red',
  P2: 'amber',
  P3: 'blue',
};

export const taskStateAccent: Record<TaskState, AccentKey> = {
  todo: 'blue',
  in_progress: 'green',
  review: 'amber',
  done: 'purple',
};

export const rubricAccent: Record<RubricCategory, AccentKey> = {
  quality: 'green',
  data_validation: 'blue',
  alignment_risk: 'purple',
  performance: 'amber',
};

/** Phase accent comes from the canonical pipeline (cycle phases); bootstrap = cyan. */
export function phaseAccent(phase: Phase): AccentKey {
  if (phase === 'bootstrap') return 'cyan';
  return accentForPhase(phase);
}

/** Whether a status is "live" — the only states allowed to glow. */
export function isLiveLoopStatus(status: LoopStatus): boolean {
  return status === 'running';
}
export function isLiveAgentStatus(status: AgentStatus): boolean {
  return status === 'running';
}

/** Human labels for statuses (UPPERCASE machine style). */
export const loopStatusLabel: Record<LoopStatus, string> = {
  running: 'RUNNING',
  idle: 'IDLE',
  paused: 'PAUSED',
  stopped: 'STOPPED',
  error: 'ERROR',
};

export const agentStatusLabel: Record<AgentStatus, string> = {
  running: 'RUNNING',
  idle: 'IDLE',
  blocked: 'BLOCKED',
  error: 'ERROR',
};
