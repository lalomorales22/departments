import { describe, expect, it } from 'vitest';
import { EscalationController } from './escalation.js';

const OK = { capAction: 'ok' as const, headroomUsd: Number.POSITIVE_INFINITY };
const SONNET_MED = { modelId: 'claude-sonnet-4-6' as const, effort: 'medium' as const };

describe('EscalationController — data-driven bump + decay', () => {
  it('returns the base unchanged at level 0', () => {
    const e = new EscalationController();
    const p = e.resolve(SONNET_MED, OK);
    expect(p).toMatchObject({ modelId: 'claude-sonnet-4-6', effort: 'medium', level: 0, refused: false });
  });

  it('climbs effort within the model on a single failure', () => {
    const e = new EscalationController();
    e.recordFailure();
    const p = e.resolve(SONNET_MED, OK);
    // medium → high (one legal rung up; still Sonnet).
    expect(p).toMatchObject({ modelId: 'claude-sonnet-4-6', effort: 'high', level: 1, refused: false });
  });

  it('steps to the next MODEL tier when effort is already at the ceiling', () => {
    const e = new EscalationController();
    e.recordFailure();
    // Sonnet at its ceiling effort `max` → next tier is judgment (Opus) at its default.
    const p = e.resolve({ modelId: 'claude-sonnet-4-6', effort: 'max' }, OK);
    expect(p).toMatchObject({ modelId: 'claude-opus-4-8', effort: 'high', level: 1, refused: false });
  });

  it('decays one tier on a clean pass and is bounded by maxLevel', () => {
    const e = new EscalationController(2);
    e.recordFailure();
    e.recordFailure();
    e.recordFailure(); // bounded at 2
    expect(e.currentLevel).toBe(2);
    e.recordCleanPass();
    expect(e.currentLevel).toBe(1);
    e.recordCleanPass();
    e.recordCleanPass(); // floored at 0
    expect(e.currentLevel).toBe(0);
  });
});

describe('EscalationController — SUBORDINATE to budget caps (precedence rule)', () => {
  it('refuses the bump when the soft cap has tripped (downgrade wins)', () => {
    const e = new EscalationController();
    e.recordFailure();
    const p = e.resolve(SONNET_MED, { capAction: 'downgrade', headroomUsd: Number.POSITIVE_INFINITY });
    expect(p).toMatchObject({ modelId: 'claude-sonnet-4-6', effort: 'medium', level: 0, refused: true });
  });

  it('refuses the bump when the hard cap has tripped (pause wins)', () => {
    const e = new EscalationController();
    e.recordFailure();
    const p = e.resolve(SONNET_MED, { capAction: 'pause', headroomUsd: Number.POSITIVE_INFINITY });
    expect(p.refused).toBe(true);
    expect(p.level).toBe(0);
  });

  it('refuses the bump when it would not fit the remaining hard-cap headroom', () => {
    const e = new EscalationController();
    e.recordFailure();
    // The escalated Sonnet/high call projects to ~$0.066; headroom of $0.01 is too thin.
    const p = e.resolve(SONNET_MED, { capAction: 'ok', headroomUsd: 0.01 });
    expect(p).toMatchObject({ level: 0, refused: true });
  });

  it('applies the bump when the cap is ok and headroom is sufficient', () => {
    const e = new EscalationController();
    e.recordFailure();
    const p = e.resolve(SONNET_MED, { capAction: 'ok', headroomUsd: 5 });
    expect(p).toMatchObject({ effort: 'high', level: 1, refused: false });
  });
});
