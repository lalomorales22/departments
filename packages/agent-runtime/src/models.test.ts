/**
 * The (model, knob) policy CI assertion (TASKS.md Phase 1).
 *
 * The policy table can NEVER pair an unsupported (model, knob). These tests are the
 * gate: every guaranteed-400 from the docs must surface as a violation, and every
 * legal pairing must pass clean. Each MODEL_TIERS entry must also be internally
 * consistent so the table itself can't drift into an illegal state.
 */
import { describe, expect, it } from 'vitest';
import {
  MODEL_TIERS,
  escalateOneTier,
  getTier,
  validateKnobs,
  type ModelId,
} from './models.js';

// ─── Negative cases: each forbidden (model, knob) MUST yield a violation ────────

describe('validateKnobs — forbidden pairings (each is a guaranteed 400)', () => {
  it('rejects Haiku + effort', () => {
    const v = validateKnobs('claude-haiku-4-5', { effort: 'low' });
    expect(v.length).toBeGreaterThan(0);
    expect(v.join(' ')).toMatch(/effort/i);
  });

  it('rejects Haiku + adaptive thinking', () => {
    const v = validateKnobs('claude-haiku-4-5', { adaptiveThinking: true });
    expect(v.length).toBeGreaterThan(0);
    expect(v.join(' ')).toMatch(/adaptive/i);
  });

  it('rejects Sonnet-4.6 + xhigh (caps at max, no xhigh rung)', () => {
    const v = validateKnobs('claude-sonnet-4-6', { effort: 'xhigh' });
    expect(v.length).toBeGreaterThan(0);
    expect(v.join(' ')).toMatch(/xhigh/i);
  });

  it('rejects Fable + thinking-disabled (must omit the param)', () => {
    const v = validateKnobs('claude-fable-5', { thinkingDisabled: true });
    expect(v.length).toBeGreaterThan(0);
    expect(v.join(' ')).toMatch(/disabled|omit/i);
  });

  it('rejects xhigh on Haiku too (unsupported effort param entirely)', () => {
    const v = validateKnobs('claude-haiku-4-5', { effort: 'xhigh' });
    expect(v.length).toBeGreaterThan(0);
  });

  it('rejects budget_tokens on Opus and Fable', () => {
    expect(validateKnobs('claude-opus-4-8', { budgetTokens: 8000 }).length).toBeGreaterThan(0);
    expect(validateKnobs('claude-fable-5', { budgetTokens: 8000, effort: 'xhigh' }).length).toBeGreaterThan(0);
  });

  it('rejects sampling params (temperature/top_p/top_k) on Opus and Fable', () => {
    expect(validateKnobs('claude-opus-4-8', { sampling: true }).length).toBeGreaterThan(0);
    expect(validateKnobs('claude-fable-5', { sampling: true, effort: 'max' }).length).toBeGreaterThan(0);
  });
});

// ─── Positive cases: each legal pairing MUST pass clean ─────────────────────────

describe('validateKnobs — legal pairings pass clean', () => {
  it('Opus + xhigh ok', () => {
    expect(validateKnobs('claude-opus-4-8', { effort: 'xhigh', adaptiveThinking: true })).toEqual([]);
  });

  it('Opus + high ok', () => {
    expect(validateKnobs('claude-opus-4-8', { effort: 'high' })).toEqual([]);
  });

  it('Sonnet + max ok', () => {
    expect(validateKnobs('claude-sonnet-4-6', { effort: 'max', adaptiveThinking: true })).toEqual([]);
  });

  it('Haiku with no effort and no adaptive ok', () => {
    expect(validateKnobs('claude-haiku-4-5', {})).toEqual([]);
  });

  it('Fable + xhigh with thinking param omitted ok', () => {
    expect(validateKnobs('claude-fable-5', { effort: 'xhigh' })).toEqual([]);
  });

  it('Fable + max ok', () => {
    expect(validateKnobs('claude-fable-5', { effort: 'max' })).toEqual([]);
  });
});

// ─── Exhaustive: no model accepts an effort outside its allowed set ─────────────

describe('validateKnobs — exhaustive effort sweep', () => {
  const ALL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

  for (const tier of MODEL_TIERS) {
    for (const effort of ALL_EFFORTS) {
      const legal = tier.allowedEfforts.includes(effort);
      it(`${tier.modelId} + ${effort} → ${legal ? 'ok' : 'violation'}`, () => {
        const v = validateKnobs(tier.modelId, { effort });
        if (legal) {
          expect(v).toEqual([]);
        } else {
          expect(v.length).toBeGreaterThan(0);
        }
      });
    }
  }
});

// ─── Table integrity: each entry is internally consistent ───────────────────────

describe('MODEL_TIERS — internal consistency', () => {
  it('has exactly one entry per known model id', () => {
    const ids = MODEL_TIERS.map((t) => t.modelId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining<ModelId>([
        'claude-opus-4-8',
        'claude-fable-5',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
      ]),
    );
    expect(ids.length).toBe(4);
  });

  for (const tier of MODEL_TIERS) {
    describe(tier.modelId, () => {
      it('supportsEffort:false ⇒ no allowed efforts and a null default', () => {
        if (!tier.supportsEffort) {
          expect(tier.allowedEfforts).toEqual([]);
          expect(tier.defaultEffort).toBeNull();
        }
      });

      it('supportsEffort:true ⇒ non-empty allowed efforts incl. the default', () => {
        if (tier.supportsEffort) {
          expect(tier.allowedEfforts.length).toBeGreaterThan(0);
          expect(tier.defaultEffort).not.toBeNull();
          if (tier.defaultEffort !== null) {
            expect(tier.allowedEfforts).toContain(tier.defaultEffort);
          }
        }
      });

      it('prices are positive', () => {
        expect(tier.priceInPerM).toBeGreaterThan(0);
        expect(tier.priceOutPerM).toBeGreaterThan(0);
      });
    });
  }

  it('Haiku context is exactly 200000; the others are 1,000,000', () => {
    expect(getTier('claude-haiku-4-5').contextTokens).toBe(200_000);
    expect(getTier('claude-opus-4-8').contextTokens).toBe(1_000_000);
    expect(getTier('claude-sonnet-4-6').contextTokens).toBe(1_000_000);
    expect(getTier('claude-fable-5').contextTokens).toBe(1_000_000);
  });

  it('only Opus and Fable carry xhigh; Sonnet caps at max; Haiku has none', () => {
    expect(getTier('claude-opus-4-8').allowedEfforts).toContain('xhigh');
    expect(getTier('claude-fable-5').allowedEfforts).toContain('xhigh');
    expect(getTier('claude-sonnet-4-6').allowedEfforts).not.toContain('xhigh');
    expect(getTier('claude-sonnet-4-6').allowedEfforts).toContain('max');
    expect(getTier('claude-haiku-4-5').allowedEfforts).toEqual([]);
  });

  it('Fable is the only always-on (omit) thinking model', () => {
    expect(getTier('claude-fable-5').omitThinkingParam).toBe(true);
    expect(getTier('claude-opus-4-8').omitThinkingParam).toBe(false);
    expect(getTier('claude-sonnet-4-6').omitThinkingParam).toBe(false);
    expect(getTier('claude-haiku-4-5').omitThinkingParam).toBe(false);
  });

  it('Haiku is the only model without adaptive thinking', () => {
    expect(getTier('claude-haiku-4-5').supportsAdaptiveThinking).toBe(false);
    expect(getTier('claude-opus-4-8').supportsAdaptiveThinking).toBe(true);
    expect(getTier('claude-sonnet-4-6').supportsAdaptiveThinking).toBe(true);
    expect(getTier('claude-fable-5').supportsAdaptiveThinking).toBe(true);
  });
});

// ─── Escalation stub: bumps stay within legal pairings ──────────────────────────

describe('escalateOneTier — proposes a legal next tier', () => {
  it('climbs effort within the same model', () => {
    expect(escalateOneTier('claude-opus-4-8', 'high')).toEqual({
      modelId: 'claude-opus-4-8',
      effort: 'xhigh',
    });
  });

  it('steps to the next model tier at the effort ceiling, resetting to its default', () => {
    const next = escalateOneTier('claude-sonnet-4-6', 'max');
    expect(next.modelId).toBe('claude-opus-4-8');
    expect(next.effort).toBe(getTier('claude-opus-4-8').defaultEffort);
  });

  it('worker (no effort) escalates to the executor tier default', () => {
    const next = escalateOneTier('claude-haiku-4-5', null);
    expect(next.modelId).toBe('claude-sonnet-4-6');
    expect(next.effort).toBe(getTier('claude-sonnet-4-6').defaultEffort);
  });

  it('every escalation result is itself a legal (model, effort) pairing', () => {
    const starts: ReadonlyArray<readonly [ModelId, ReturnType<typeof getTier>['defaultEffort']]> = [
      ['claude-haiku-4-5', null],
      ['claude-sonnet-4-6', 'medium'],
      ['claude-sonnet-4-6', 'max'],
      ['claude-opus-4-8', 'high'],
      ['claude-opus-4-8', 'xhigh'],
      ['claude-fable-5', 'max'],
    ];
    for (const [modelId, effort] of starts) {
      const next = escalateOneTier(modelId, effort);
      const knobs = next.effort === null ? {} : { effort: next.effort };
      expect(validateKnobs(next.modelId, knobs)).toEqual([]);
    }
  });

  it('top tier at ceiling effort is a no-op (nothing left to escalate)', () => {
    expect(escalateOneTier('claude-fable-5', 'max')).toEqual({
      modelId: 'claude-fable-5',
      effort: 'max',
    });
  });
});
