'use client';

import { useMemo } from 'react';
import type { Agent, AgentRole } from '@departments/shared';
import { LOCAL_ORG_ID } from './workspace';
import { useCockpit, type ProviderConfig, type OrchestratorRole } from './store';

/**
 * The canonical orchestrator roster, with each role's model resolved from the ACTUAL
 * provider selection — so the agent grid + Inspector show the local Ollama models you
 * picked (per role), not a hardcoded Claude tier. The engine drives one role per phase:
 * planner→PLAN, executor→EXECUTE, reviewer→EVALUATE/IMPROVE, docs→MEMORY.
 */
interface RosterEntry {
  role: OrchestratorRole;
  name: string;
  tier: 'judgment' | 'executor';
}

const ROSTER: RosterEntry[] = [
  { role: 'planner', name: 'Planner', tier: 'judgment' },
  { role: 'executor', name: 'Executor', tier: 'executor' },
  { role: 'reviewer', name: 'Reviewer', tier: 'judgment' },
  { role: 'docs', name: 'Docs', tier: 'executor' },
];

const CLAUDE_TIER: Record<RosterEntry['tier'], { modelId: string; effort: string }> = {
  judgment: { modelId: 'claude-opus-4-8', effort: 'high' },
  executor: { modelId: 'claude-sonnet-4-6', effort: 'medium' },
};

function modelForRole(cfg: ProviderConfig, entry: RosterEntry): { modelId: string; effort: string | null } {
  if (cfg.provider === 'ollama') {
    // Optional-chain: an older persisted config (pre per-role models) has no map.
    const m = cfg.ollamaRoleModels?.[entry.role] || cfg.ollamaModel || '— pick a model —';
    return { modelId: m, effort: null }; // local models are knobless
  }
  // Claude: a pinned model for every role, else the per-role tier default.
  if (cfg.claudeModel) return { modelId: cfg.claudeModel, effort: CLAUDE_TIER[entry.tier].effort };
  return CLAUDE_TIER[entry.tier];
}

export function rosterForProvider(loopId: string, cfg: ProviderConfig): Agent[] {
  return ROSTER.map((entry) => {
    const { modelId, effort } = modelForRole(cfg, entry);
    return {
      id: `${loopId}-${entry.role}`,
      orgId: LOCAL_ORG_ID,
      loopId,
      role: entry.role as AgentRole,
      name: entry.name,
      modelId,
      effort,
      status: 'idle' as const,
      activity: 'Standing by',
      createdAt: '2026-01-01T00:00:00Z',
    };
  });
}

/** Reactive roster bound to the current provider/model selection. */
export function useAgentRoster(loopId: string): Agent[] {
  const cfg = useCockpit((s) => s.providerConfig);
  return useMemo(() => rosterForProvider(loopId, cfg), [loopId, cfg]);
}
