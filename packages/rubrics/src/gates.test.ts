import { describe, it, expect } from 'vitest';
import { RUBRIC_CATEGORIES, type RubricCategory } from '@departments/shared';
import {
  DEFAULT_GATE_THRESHOLDS,
  HealthController,
  PHASE_GATES,
  clearsThreshold,
  enforceBoundary,
  gateOutcomesFromHeuristic,
  gatePassRate,
  gatesForBoundary,
  rollingHealth,
  type GateOutcome,
  type GateThresholdConfig,
} from './gates';

/** All four gates passing at a strong score. */
function allPass(score = 90): GateOutcome[] {
  return RUBRIC_CATEGORIES.map((category) => ({ category, passed: true, score }));
}

/** All four passing except the named category, which fails. */
function failing(category: RubricCategory, score = 55): GateOutcome[] {
  return RUBRIC_CATEGORIES.map((c) => ({ category: c, passed: c !== category, score: c === category ? score : 90 }));
}

describe('PHASE_GATES', () => {
  it('binds the README phase→gate mapping', () => {
    expect(PHASE_GATES.plan).toEqual(['alignment_risk']);
    expect(PHASE_GATES.execute).toEqual(['quality', 'data_validation']);
    expect(PHASE_GATES.evaluate).toEqual([...RUBRIC_CATEGORIES]);
    expect(PHASE_GATES.improve).toEqual(['performance']);
  });

  it('gatesForBoundary returns the assigned categories', () => {
    expect(gatesForBoundary('improve')).toEqual(['performance']);
  });
});

describe('clearsThreshold', () => {
  it('requires both the grader pass flag AND the configured floor', () => {
    expect(clearsThreshold({ category: 'quality', passed: true, score: 80 }, { minScore: 60, required: true })).toBe(true);
    // grader passed but below a tightened floor → fails
    expect(clearsThreshold({ category: 'quality', passed: true, score: 80 }, { minScore: 90, required: true })).toBe(false);
    // grader failed → never clears, even with a loosened floor
    expect(clearsThreshold({ category: 'quality', passed: false, score: 80 }, { minScore: 10, required: true })).toBe(false);
  });
});

describe('enforceBoundary', () => {
  it('allows EVALUATE when all four gates clear', () => {
    const e = enforceBoundary('evaluate', allPass());
    expect(e.allowed).toBe(true);
    expect(e.blocking).toEqual([]);
    expect(e.passRate).toBe(1);
  });

  it('blocks IMPROVE when the performance gate fails (Performance→IMPROVE)', () => {
    const e = enforceBoundary('improve', failing('performance'));
    expect(e.allowed).toBe(false);
    expect(e.blocking).toEqual(['performance']);
  });

  it('a performance failure does NOT block EXECUTE (Quality+Data only there)', () => {
    const e = enforceBoundary('execute', failing('performance'));
    expect(e.allowed).toBe(true);
    expect(e.failing).toEqual([]);
  });

  it('blocks EXECUTE when quality fails', () => {
    const e = enforceBoundary('execute', failing('quality'));
    expect(e.allowed).toBe(false);
    expect(e.blocking).toEqual(['quality']);
  });

  it('advisory (non-required) gate fails but does not block', () => {
    const config: GateThresholdConfig = {
      ...DEFAULT_GATE_THRESHOLDS,
      performance: { minScore: 60, required: false },
    };
    const e = enforceBoundary('improve', failing('performance'), config);
    expect(e.allowed).toBe(true);
    expect(e.failing).toEqual(['performance']);
    expect(e.blocking).toEqual([]);
  });

  it('is permissive when no verdict is available for the boundary', () => {
    const e = enforceBoundary('plan', []);
    expect(e.allowed).toBe(true);
    expect(e.passRate).toBe(1);
  });
});

describe('gatePassRate', () => {
  it('is 1.0 when all gates clear and 0.75 when one of four fails', () => {
    expect(gatePassRate(allPass())).toBe(1);
    expect(gatePassRate(failing('performance'))).toBe(0.75);
  });

  it('reflects a tightened threshold (preview behavior)', () => {
    const strict: GateThresholdConfig = {
      ...DEFAULT_GATE_THRESHOLDS,
      quality: { minScore: 95, required: true },
    };
    // all four pass at 90, but quality's floor is now 95 → 3/4
    expect(gatePassRate(allPass(90), strict)).toBe(0.75);
  });

  it('returns 1 for an ungraded set', () => {
    expect(gatePassRate([])).toBe(1);
  });
});

describe('rollingHealth + HealthController', () => {
  it('rolls per-cycle pass rates into a 0-100 integer', () => {
    expect(rollingHealth([])).toBe(100);
    expect(rollingHealth([1, 1, 1])).toBe(100);
    expect(rollingHealth([0.75, 0.75])).toBe(75);
    expect(rollingHealth([1, 0.5])).toBe(75);
  });

  it('honors the window (only recent cycles count)', () => {
    // window 2: only the last two (1, 1) → 100
    expect(rollingHealth([0, 0, 1, 1], 2)).toBe(100);
  });

  it('HealthController accumulates and decays across cycles', () => {
    const h = new HealthController();
    expect(h.health).toBe(100);
    h.recordGates(allPass());
    expect(h.health).toBe(100);
    h.recordGates(failing('performance')); // 0.75
    // mean(1, 0.75) = 0.875 → 88
    expect(h.health).toBe(88);
    expect(h.cycles).toBe(2);
    // a clean cycle pulls it back up
    h.recordGates(allPass());
    // mean(1, 0.75, 1) = 0.9167 → 92
    expect(h.health).toBe(92);
  });

  it('seeds from prior history', () => {
    const h = new HealthController(10, [0.5, 0.5]);
    expect(h.health).toBe(50);
  });
});

describe('gateOutcomesFromHeuristic (offline bridge)', () => {
  it('scales the 0-1 heuristic grader to 0-100 outcomes', () => {
    const outcomes = gateOutcomesFromHeuristic({
      changedFiles: ['src/feature.ts'],
      meaningfulDiff: true,
      metricsMoved: true,
      claimsVerified: true,
    });
    expect(outcomes).toHaveLength(4);
    for (const o of outcomes) {
      expect(o.score).toBeGreaterThanOrEqual(0);
      expect(o.score).toBeLessThanOrEqual(100);
    }
    // a strong signal set clears the default boundary
    expect(enforceBoundary('evaluate', outcomes).allowed).toBe(true);
  });

  it('a stalled (no meaningful diff) cycle fails quality + alignment health', () => {
    const outcomes = gateOutcomesFromHeuristic({
      changedFiles: ['HANDOFF.md'],
      meaningfulDiff: false,
      metricsMoved: false,
      claimsVerified: false,
    });
    // quality + data + alignment + performance all below 60 → pass rate 0
    expect(gatePassRate(outcomes)).toBe(0);
  });
});
