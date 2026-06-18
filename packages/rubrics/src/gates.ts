/**
 * The four gates as ENFORCED phase-boundary guardrails + Health % = rolling gate
 * pass rate.
 *
 * Phases 2–4 produced per-gate verdicts and routed rework on the Outcome result.
 * Phase 5 makes the gates *binding*: each phase boundary enforces the gate categories
 * assigned to it (PLAN→Alignment; EXECUTE→Quality+Data; EVALUATE→all four;
 * Performance→IMPROVE — README "The four gates"), thresholds are configurable, and a
 * loop's **Health %** is the rolling fraction of gates that cleared their threshold
 * over the recent window. This is pure, deterministic math — the engine threads a
 * {@link HealthController} across cycles (like the escalation controller) and consults
 * {@link enforceBoundary} at the EVALUATE→IMPROVE barrier.
 *
 * Scale: scores are 0–100 here, matching the runtime's `GateVerdict.score` (the
 * authoritative independent CMA grader; the offline heuristic in `./grade` is 0–1 and
 * is bridged by {@link gateOutcomesFromHeuristic}). Thresholds are 0–100 to line up
 * with the cockpit's gate-threshold sliders.
 */
import { RUBRIC_CATEGORIES, type RubricCategory } from '@departments/shared';
import { gradeSignals, type GateResult, type GradeSignals } from './grade';

/**
 * A normalized gate outcome the enforcer + health tracker consume. Structurally a
 * subset of the runtime's `GateVerdict`, so the engine passes verdict gates straight
 * in. `score` is 0–100; `passed` is the independent grader's own pass flag.
 */
export interface GateOutcome {
  category: RubricCategory;
  passed: boolean;
  /** 0–100 (the GateVerdict scale). */
  score: number;
}

/** A single gate's pass policy. */
export interface GateThreshold {
  /** Minimum 0–100 score required to clear this gate. */
  minScore: number;
  /**
   * When `true`, a gate that fails its threshold BLOCKS progression past the boundary
   * it is enforced at. When `false` it is advisory — it still drags Health % down, but
   * never halts the cycle (lets an org soften a gate without disabling its signal).
   */
  required: boolean;
}

export type GateThresholdConfig = Record<RubricCategory, GateThreshold>;

/** Default minimum score — mirrors the heuristic grader's 0.6 pass bar (→ 60/100). */
export const DEFAULT_GATE_MIN_SCORE = 60 as const;

/** Default thresholds: every gate required at the 60/100 bar. */
export const DEFAULT_GATE_THRESHOLDS: GateThresholdConfig = {
  quality: { minScore: DEFAULT_GATE_MIN_SCORE, required: true },
  data_validation: { minScore: DEFAULT_GATE_MIN_SCORE, required: true },
  alignment_risk: { minScore: DEFAULT_GATE_MIN_SCORE, required: true },
  performance: { minScore: DEFAULT_GATE_MIN_SCORE, required: true },
};

/**
 * Which gate categories are enforced at which phase boundary, per the README:
 *   PLAN → Alignment/Risk · EXECUTE → Quality + Data validation ·
 *   EVALUATE → all four · IMPROVE(OPTIMIZE) → Performance.
 * The grader scores all four in the independent EVALUATE Outcome; this map says which
 * subset is *binding* at each boundary so a Quality miss can't slip past EXECUTE and a
 * Performance miss can't slip into IMPROVE.
 */
export const PHASE_GATES: Readonly<Record<'plan' | 'execute' | 'evaluate' | 'improve', readonly RubricCategory[]>> = {
  plan: ['alignment_risk'],
  execute: ['quality', 'data_validation'],
  evaluate: RUBRIC_CATEGORIES,
  improve: ['performance'],
};

/** Gate categories binding at a phase boundary (empty for boundaries with none). */
export function gatesForBoundary(phase: keyof typeof PHASE_GATES): readonly RubricCategory[] {
  return PHASE_GATES[phase] ?? [];
}

/**
 * Whether a gate clears its threshold: the independent grader must pass it AND it must
 * meet the configured floor. Loosening the floor below the grader's bar can never make
 * a grader-failed gate pass (no overriding the independent grader downward); tightening
 * it above can fail an otherwise-passing gate (a stricter org policy).
 */
export function clearsThreshold(outcome: GateOutcome, threshold: GateThreshold): boolean {
  return outcome.passed && outcome.score >= threshold.minScore;
}

/** The result of enforcing the gates binding at one phase boundary. */
export interface GateEnforcement {
  /** False iff a REQUIRED enforced gate failed its threshold (a hard barrier). */
  allowed: boolean;
  /** Every enforced gate that failed its threshold (required or advisory). */
  failing: RubricCategory[];
  /** The required failures — the actual blockers. */
  blocking: RubricCategory[];
  /** Pass fraction over the enforced categories present in `outcomes` (0–1). */
  passRate: number;
}

function configFor(config: GateThresholdConfig | undefined, category: RubricCategory): GateThreshold {
  return config?.[category] ?? DEFAULT_GATE_THRESHOLDS[category];
}

/**
 * Enforce the gates binding at a phase boundary against the latest gate outcomes.
 * Only categories that are both (a) assigned to this boundary and (b) present in
 * `outcomes` are considered, so a boundary with no available verdict (e.g. PLAN on a
 * cold start) is permissive (`allowed: true`, `passRate: 1`).
 */
export function enforceBoundary(
  phase: keyof typeof PHASE_GATES,
  outcomes: readonly GateOutcome[],
  config: GateThresholdConfig = DEFAULT_GATE_THRESHOLDS,
): GateEnforcement {
  const assigned = new Set(gatesForBoundary(phase));
  const byCategory = new Map(outcomes.map((o) => [o.category, o]));
  const considered = [...assigned].filter((c) => byCategory.has(c));

  const failing: RubricCategory[] = [];
  const blocking: RubricCategory[] = [];
  let cleared = 0;
  for (const category of considered) {
    const outcome = byCategory.get(category)!;
    if (clearsThreshold(outcome, configFor(config, category))) {
      cleared += 1;
    } else {
      failing.push(category);
      if (configFor(config, category).required) blocking.push(category);
    }
  }

  return {
    allowed: blocking.length === 0,
    failing,
    blocking,
    passRate: considered.length === 0 ? 1 : cleared / considered.length,
  };
}

/**
 * The gate pass rate over a full set of outcomes (0–1) — the rolling-health input.
 * Counts every category in `RUBRIC_CATEGORIES` that has an outcome and clears its
 * threshold. Returns 1 when nothing was graded (a fresh loop is presumed healthy until
 * its first verdict).
 */
export function gatePassRate(
  outcomes: readonly GateOutcome[],
  config: GateThresholdConfig = DEFAULT_GATE_THRESHOLDS,
): number {
  const byCategory = new Map(outcomes.map((o) => [o.category, o]));
  const graded = RUBRIC_CATEGORIES.filter((c) => byCategory.has(c));
  if (graded.length === 0) return 1;
  const cleared = graded.filter((c) => clearsThreshold(byCategory.get(c)!, configFor(config, c))).length;
  return cleared / graded.length;
}

/** Health window (cycles) over which the rolling gate-pass rate is averaged. */
export const HEALTH_WINDOW = 10 as const;

/**
 * Roll a window of per-cycle pass rates (each 0–1) into a 0–100 integer health score.
 * An ungraded history yields 100 (presumed healthy). Always returns an integer so the
 * value persisted to `Loop.health` and the DB is exact.
 */
export function rollingHealth(passRates: readonly number[], window: number = HEALTH_WINDOW): number {
  const recent = passRates.slice(-window);
  if (recent.length === 0) return 100;
  const mean = recent.reduce((sum, r) => sum + clamp01(r), 0) / recent.length;
  return Math.round(mean * 100);
}

/**
 * Threads rolling gate-pass health across a loop's cycles. The engine owns one
 * instance per loop (injected like the EscalationController) so health persists and
 * decays across the run; absent one, the engine uses a fresh per-cycle controller.
 */
export class HealthController {
  private readonly passRates: number[] = [];

  constructor(
    private readonly window: number = HEALTH_WINDOW,
    seed: readonly number[] = [],
  ) {
    this.passRates.push(...seed.map(clamp01));
  }

  /** Record one cycle's pass rate (0–1); returns the new rolling health (0–100). */
  record(passRate: number): number {
    this.passRates.push(clamp01(passRate));
    return this.health;
  }

  /** Record a full cycle's gate outcomes; returns the new rolling health (0–100). */
  recordGates(outcomes: readonly GateOutcome[], config?: GateThresholdConfig): number {
    return this.record(gatePassRate(outcomes, config));
  }

  /** Current rolling health (0–100 integer). */
  get health(): number {
    return rollingHealth(this.passRates, this.window);
  }

  /** Number of cycles recorded. */
  get cycles(): number {
    return this.passRates.length;
  }
}

/**
 * Bridge the offline heuristic grader (`gradeSignals`, 0–1) into 0–100 `GateOutcome`s,
 * so tests and the local path can drive gate enforcement without the CMA runtime. The
 * authoritative production path uses the independent CMA grader's `GateVerdict`s
 * directly — never this heuristic (no self-grading).
 */
export function gateOutcomesFromHeuristic(signals: GradeSignals): GateOutcome[] {
  return gradeSignals(signals).map((r: GateResult) => ({
    category: r.category,
    passed: r.passed,
    score: Math.round(r.score * 100),
  }));
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
