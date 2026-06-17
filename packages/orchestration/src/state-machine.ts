/**
 * The cycle state machine — PURE routing predicates, no I/O. Unit-tested in
 * `state-machine.test.ts`. The engine composes these to drive the real cycle.
 *
 * Canonical order: PLAN → EXECUTE → EVALUATE → IMPROVE(OPTIMIZE) → MEMORY → (wrap).
 * Gate routing: an EVALUATE that isn't satisfied routes back to EXECUTE (rework),
 * bounded by `maxIterations`; once settled, IMPROVE always runs (writes REPORT.md),
 * then MEMORY writes the handoff and wraps to the next cycle's PLAN.
 */
import { CYCLE_PHASES, type CyclePhase, type OutcomeResult } from '@departments/shared';

export const CYCLE_ORDER: readonly CyclePhase[] = CYCLE_PHASES;

export type EvaluateRoute = 'rework' | 'settled';

/**
 * Decide what to do after an EVALUATE verdict.
 * - `satisfied` → settled (proceed to IMPROVE).
 * - `needs_revision` and under the iteration cap → rework (back to EXECUTE).
 * - `max_iterations_reached` / `failed` → settled (proceed, flagged upstream).
 */
export function routeEvaluate(
  result: OutcomeResult,
  iteration: number,
  maxIterations: number,
): EvaluateRoute {
  if (result === 'satisfied') return 'settled';
  if (result === 'needs_revision' && iteration < maxIterations) return 'rework';
  return 'settled';
}

export function isCleanPass(result: OutcomeResult): boolean {
  return result === 'satisfied';
}

/** Next phase in the cycle, wrapping MEMORY → PLAN. */
export function advance(phase: CyclePhase): { next: CyclePhase; wrapped: boolean } {
  const i = CYCLE_ORDER.indexOf(phase);
  const ni = (i + 1) % CYCLE_ORDER.length;
  return { next: CYCLE_ORDER[ni]!, wrapped: ni === 0 };
}

/** The cycle counter increments once a MEMORY phase completes (one full traversal). */
export function bumpCycleOnWrap(phase: CyclePhase, cycle: number): number {
  return phase === 'memory' ? cycle + 1 : cycle;
}
