/**
 * Fixture data backbone for the cockpit. Everything the UI binds to in Phase 1 comes
 * from here. The selector API (get*) mirrors what the GraphQL/REST gateway will
 * expose in later phases, so swapping fixtures → live data is a thin change.
 */
import type { Phase, PipelineState } from '@departments/shared';
import { getLoop } from './loops';

export * from './loops';
export * from './agents';
export * from './tasks';
export * from './metrics';
export * from './memory';
export * from './artifacts';
export * from './logs';
export * from './activity';

/** Rubric gate snapshot for a loop's most recent EVALUATE (inspector + pipeline). */
export interface GateSnapshot {
  category: 'quality' | 'data_validation' | 'alignment_risk' | 'performance';
  passed: boolean;
  score: number;
}

export function getGates(_loopId: string): GateSnapshot[] {
  return [
    { category: 'quality', passed: true, score: 94 },
    { category: 'data_validation', passed: true, score: 97 },
    { category: 'alignment_risk', passed: true, score: 91 },
    { category: 'performance', passed: false, score: 73 },
  ];
}

/**
 * Derive a live-looking pipeline state for a loop. `elapsedSeconds` is seeded so the
 * center timer has a believable starting value; the UI ticks it forward client-side.
 */
export function getPipelineState(loopId: string): PipelineState {
  const loop = getLoop(loopId);
  const active = loop?.phase ?? null;
  const order: Phase[] = ['plan', 'execute', 'evaluate', 'improve', 'memory'];
  const activeIdx = active ? order.indexOf(active) : -1;
  const stageStatus: PipelineState['stageStatus'] = {};
  order.forEach((p, i) => {
    if (activeIdx < 0) stageStatus[p] = 'pending';
    else if (i < activeIdx) stageStatus[p] = 'complete';
    else if (i === activeIdx) stageStatus[p] = 'active';
    else stageStatus[p] = 'pending';
  });
  return {
    activePhase: active,
    stageStatus,
    cycleCount: loop?.cycleCount ?? 0,
    elapsedSeconds: 1972, // ~32m53s into the current cycle
  };
}
