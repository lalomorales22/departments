/**
 * A DETERMINISTIC heuristic grader that scores the four gates from objective signals.
 *
 * ⚠️ This is NOT the authoritative grader. The real EVALUATE gate is the independent
 * CMA Outcome (Opus 4.8) running in its own context against `GATE_CRITERIA` — agents
 * never grade their own Alignment/Risk gate (no self-grading; see README guardrails).
 * This function is the no-self-grading SCAFFOLD that the real CMA Outcome maps onto:
 * it gives the local/offline driver and the unit tests a stable, signal-driven verdict
 * with no model call. Scores are derived purely from objective facts about the run
 * (did a meaningful diff land? did metrics move? were claims verified?), so the same
 * inputs always yield the same gate results.
 */
import { RUBRIC_CATEGORIES, type RubricCategory } from '@departments/shared';

/** One gate's verdict: pass/fail plus a 0–1 score and a short explanation. */
export interface GateResult {
  category: RubricCategory;
  passed: boolean;
  score: number;
  notes: string;
}

/** Objective signals observed about a run, fed to the heuristic grader. */
export interface GradeSignals {
  /** Paths changed in the snapshot (empty = nothing changed). */
  changedFiles: string[];
  /** Whether the diff is MEANINGFUL (real change, not HANDOFF/timestamp churn). */
  meaningfulDiff: boolean;
  /** Whether the tracked success metrics moved in the good direction. */
  metricsMoved: boolean;
  /** Whether factual claims/numbers were verified against sources/artifacts. */
  claimsVerified: boolean;
}

/** A gate passes when its score clears this threshold. */
const PASS_THRESHOLD = 0.6;

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function gate(category: RubricCategory, score: number, notes: string): GateResult {
  const s = clamp01(score);
  return { category, passed: s >= PASS_THRESHOLD, score: s, notes };
}

/**
 * Score each of the four gates from objective signals. Always returns exactly one
 * `GateResult` per category in `RUBRIC_CATEGORIES`, in that order.
 *
 * Heuristics:
 *  - quality:        high when a meaningful diff landed; an empty diff fails outright.
 *  - data_validation: driven by `claimsVerified`.
 *  - alignment_risk:  meaningful, on-mission work scores high; an empty diff can't be
 *                     judged on-mission, so it does not pass.
 *  - performance:     driven by `metricsMoved`.
 */
export function gradeSignals(signals: GradeSignals): GateResult[] {
  const { changedFiles, meaningfulDiff, metricsMoved, claimsVerified } = signals;
  const hasDiff = changedFiles.length > 0;

  const results: Record<RubricCategory, GateResult> = {
    quality: hasDiff
      ? meaningfulDiff
        ? gate('quality', 0.9, 'Meaningful diff landed; output is substantive and complete.')
        : gate(
            'quality',
            0.4,
            'Files changed but the diff is not meaningful (churn/timestamp only).',
          )
      : gate('quality', 0.0, 'No files changed — nothing was produced to grade.'),

    data_validation: claimsVerified
      ? gate('data_validation', 0.9, 'Claims, numbers, and facts were verified against sources.')
      : gate('data_validation', 0.3, 'Claims were not verified; accuracy is unconfirmed.'),

    alignment_risk: meaningfulDiff
      ? gate('alignment_risk', 0.85, 'Meaningful on-mission work within scope and policy.')
      : gate(
          'alignment_risk',
          0.3,
          'No meaningful change to assess for on-mission alignment.',
        ),

    performance: metricsMoved
      ? gate('performance', 0.9, 'Tracked success metrics moved in the intended direction.')
      : gate('performance', 0.3, 'No measured metric movement against the success metrics.'),
  };

  return RUBRIC_CATEGORIES.map((category) => results[category]);
}
