import { describe, it, expect } from 'vitest';
import { RUBRIC_CATEGORIES, type RubricCategory } from '@departments/shared';
import { GATE_CRITERIA, RubricLibrary } from './rubrics';
import { gradeSignals, type GateResult, type GradeSignals } from './grade';

function byCategory(results: GateResult[]): Record<RubricCategory, GateResult> {
  const out = {} as Record<RubricCategory, GateResult>;
  for (const r of results) out[r.category] = r;
  return out;
}

const baseSignals: GradeSignals = {
  changedFiles: [],
  meaningfulDiff: false,
  metricsMoved: false,
  claimsVerified: false,
};

describe('GATE_CRITERIA', () => {
  it('covers all four rubric categories', () => {
    expect(Object.keys(GATE_CRITERIA).sort()).toEqual([...RUBRIC_CATEGORIES].sort());
  });

  it('has non-empty Markdown text for every gate', () => {
    for (const category of RUBRIC_CATEGORIES) {
      const text = GATE_CRITERIA[category];
      expect(text.trim().length).toBeGreaterThan(0);
      // Each gate is authored as a Markdown section.
      expect(text).toContain('##');
    }
  });
});

describe('RubricLibrary', () => {
  it('returns GATE_CRITERIA for any loop id (override hook ignored for now)', () => {
    const lib = new RubricLibrary();
    expect(lib.criteria('loop-a')).toEqual(GATE_CRITERIA);
    expect(lib.criteria('loop-b')).toEqual(GATE_CRITERIA);
  });
});

describe('gradeSignals', () => {
  it('returns exactly four results, one per category in canonical order', () => {
    const results = gradeSignals(baseSignals);
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.category)).toEqual([...RUBRIC_CATEGORIES]);
  });

  it('keeps every score within 0..1', () => {
    const results = gradeSignals({
      changedFiles: ['src/a.ts'],
      meaningfulDiff: true,
      metricsMoved: true,
      claimsVerified: true,
    });
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(r.passed).toBe(r.score >= 0.6);
    }
  });

  it('passes quality and performance for a meaningful diff with moved metrics', () => {
    const results = byCategory(
      gradeSignals({
        changedFiles: ['src/feature.ts'],
        meaningfulDiff: true,
        metricsMoved: true,
        claimsVerified: false,
      }),
    );
    expect(results.quality.passed).toBe(true);
    expect(results.performance.passed).toBe(true);
  });

  it('fails quality when the diff is empty', () => {
    const results = byCategory(gradeSignals(baseSignals));
    expect(results.quality.passed).toBe(false);
    expect(results.quality.score).toBe(0);
  });

  it('drives data_validation off claimsVerified', () => {
    const verified = byCategory(gradeSignals({ ...baseSignals, claimsVerified: true }));
    const unverified = byCategory(gradeSignals({ ...baseSignals, claimsVerified: false }));
    expect(verified.data_validation.passed).toBe(true);
    expect(unverified.data_validation.passed).toBe(false);
  });

  it('does not pass quality when files changed but the diff is not meaningful', () => {
    const results = byCategory(
      gradeSignals({
        changedFiles: ['HANDOFF.md'],
        meaningfulDiff: false,
        metricsMoved: false,
        claimsVerified: false,
      }),
    );
    expect(results.quality.passed).toBe(false);
    // It scores above an empty diff but below the pass threshold.
    expect(results.quality.score).toBeGreaterThan(0);
    expect(results.quality.score).toBeLessThan(0.6);
  });

  it('is deterministic for identical signals', () => {
    const signals: GradeSignals = {
      changedFiles: ['src/x.ts', 'src/y.ts'],
      meaningfulDiff: true,
      metricsMoved: false,
      claimsVerified: true,
    };
    expect(gradeSignals(signals)).toEqual(gradeSignals(signals));
  });
});
