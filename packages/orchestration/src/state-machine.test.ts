import { describe, expect, it } from 'vitest';
import { advance, bumpCycleOnWrap, isCleanPass, routeEvaluate } from './state-machine.js';

describe('routeEvaluate (gate routing)', () => {
  it('settles when satisfied', () => {
    expect(routeEvaluate('satisfied', 0, 3)).toBe('settled');
  });
  it('reworks on needs_revision under the iteration cap', () => {
    expect(routeEvaluate('needs_revision', 0, 3)).toBe('rework');
    expect(routeEvaluate('needs_revision', 2, 3)).toBe('rework');
  });
  it('settles when the iteration cap is hit', () => {
    expect(routeEvaluate('needs_revision', 3, 3)).toBe('settled');
    expect(routeEvaluate('max_iterations_reached', 1, 3)).toBe('settled');
    expect(routeEvaluate('failed', 0, 3)).toBe('settled');
  });
});

describe('advance (cycle order + wrap)', () => {
  it('moves through the canonical order', () => {
    expect(advance('plan')).toEqual({ next: 'execute', wrapped: false });
    expect(advance('execute')).toEqual({ next: 'evaluate', wrapped: false });
    expect(advance('evaluate')).toEqual({ next: 'improve', wrapped: false });
    expect(advance('improve')).toEqual({ next: 'memory', wrapped: false });
  });
  it('wraps MEMORY → PLAN', () => {
    expect(advance('memory')).toEqual({ next: 'plan', wrapped: true });
  });
});

describe('bumpCycleOnWrap', () => {
  it('increments only after MEMORY', () => {
    expect(bumpCycleOnWrap('memory', 4)).toBe(5);
    expect(bumpCycleOnWrap('plan', 4)).toBe(4);
    expect(bumpCycleOnWrap('improve', 4)).toBe(4);
  });
});

describe('isCleanPass', () => {
  it('is true only for satisfied', () => {
    expect(isCleanPass('satisfied')).toBe(true);
    expect(isCleanPass('needs_revision')).toBe(false);
    expect(isCleanPass('max_iterations_reached')).toBe(false);
  });
});
