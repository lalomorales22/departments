import type { Agent, AgentRole } from '@departments/shared';
import { LOCAL_ORG_ID } from '../workspace';

/**
 * The canonical agent roster every loop runs — these are REAL roles (the engine drives one
 * per phase: planner→PLAN, executor→EXECUTE, reviewer→EVALUATE/IMPROVE, docs→MEMORY), not
 * mock personas. `useLiveAgents` lights up the active role during a run. The model shown is
 * the platform's default tier; the ACTUAL model for a run is the one chosen in Settings →
 * AI Provider (surfaced in the run logs + provider badge).
 */
interface RosterEntry {
  role: AgentRole;
  name: string;
  modelId: string;
  effort: string | null;
}

const ROSTER: RosterEntry[] = [
  { role: 'planner', name: 'Planner', modelId: 'claude-opus-4-8', effort: 'high' },
  { role: 'executor', name: 'Executor', modelId: 'claude-sonnet-4-6', effort: 'medium' },
  { role: 'reviewer', name: 'Reviewer', modelId: 'claude-opus-4-8', effort: 'high' },
  { role: 'docs', name: 'Docs', modelId: 'claude-sonnet-4-6', effort: 'medium' },
];

/** No standing roster rows — agents are derived per-loop from {@link getAgents}. */
export const AGENTS: Agent[] = [];

export function getAgents(loopId: string): Agent[] {
  return ROSTER.map((r) => ({
    id: `${loopId}-${r.role}`,
    orgId: LOCAL_ORG_ID,
    loopId,
    role: r.role,
    name: r.name,
    modelId: r.modelId,
    effort: r.effort,
    status: 'idle' as const,
    activity: 'Standing by',
    createdAt: '2026-01-01T00:00:00Z',
  }));
}

export function getAgent(id: string): Agent | undefined {
  const entry = ROSTER.find((r) => id.endsWith(`-${r.role}`));
  if (!entry) return undefined;
  const loopId = id.slice(0, id.length - (`-${entry.role}`).length);
  return getAgents(loopId).find((a) => a.id === id);
}
