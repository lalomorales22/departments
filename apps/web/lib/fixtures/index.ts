/**
 * Fixture data backbone for the cockpit. Everything the UI binds to in Phase 1 comes
 * from here. The selector API (get*) mirrors what the GraphQL/REST gateway will
 * expose in later phases, so swapping fixtures → live data is a thin change.
 */
import type { Phase, PipelineState } from '@departments/shared';

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

/** Gate snapshot. Real gate verdicts come from a loop's live EVALUATE events; no mock seed. */
export function getGates(_loopId: string): GateSnapshot[] {
  return [];
}

/**
 * The idle pipeline state for a loop that hasn't streamed any events yet (all stages
 * pending). Once a run streams, `useLivePipeline` derives the real active phase + cycle.
 */
export function getPipelineState(_loopId: string): PipelineState {
  const order: Phase[] = ['plan', 'execute', 'evaluate', 'improve', 'memory'];
  const stageStatus: PipelineState['stageStatus'] = {};
  order.forEach((p) => {
    stageStatus[p] = 'pending';
  });
  return { activePhase: null, stageStatus, cycleCount: 0, elapsedSeconds: 0 };
}
