import { describe, expect, it } from 'vitest';
import type { TokenUsage } from '@departments/shared';
import {
  CACHE_COLD_RATIO,
  CacheAuditor,
  assertCacheHit,
  auditCacheHit,
  cacheReadRatio,
} from './caching.js';

/** A warm tick: most input served from cache. */
function warm(): TokenUsage {
  return { inputTokens: 1_000, outputTokens: 400, cacheReadInputTokens: 9_000, cacheCreationInputTokens: 0 };
}
/** A cold tick: cache write, no reads (the expected first/cold-start shape). */
function cold(): TokenUsage {
  return { inputTokens: 10_000, outputTokens: 400, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
}

describe('cacheReadRatio', () => {
  it('is the fraction of input served from cache (output excluded)', () => {
    expect(cacheReadRatio(warm())).toBeCloseTo(0.9, 10);
    expect(cacheReadRatio(cold())).toBe(0);
  });
  it('is 0 when there is no input', () => {
    expect(cacheReadRatio({ inputTokens: 0, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 })).toBe(0);
  });
});

describe('auditCacheHit', () => {
  it('flags a warm tick as a hit and not cold', () => {
    const a = auditCacheHit(warm());
    expect(a.hit).toBe(true);
    expect(a.cold).toBe(false);
    expect(a.degraded).toBe(false);
  });

  it('a cold start is cold but NOT degraded (no prior baseline)', () => {
    const a = auditCacheHit(cold());
    expect(a.cold).toBe(true);
    expect(a.degraded).toBe(false);
  });

  it('flags MID-LIFE degradation: warm prior baseline → cold now', () => {
    const a = auditCacheHit(cold(), 0.9);
    expect(a.cold).toBe(true);
    expect(a.degraded).toBe(true);
  });

  it('does not flag degradation when still warm', () => {
    expect(auditCacheHit(warm(), 0.9).degraded).toBe(false);
  });

  it('CACHE_COLD_RATIO is the cold boundary', () => {
    const justCold: TokenUsage = {
      inputTokens: 100 * (1 - CACHE_COLD_RATIO),
      outputTokens: 0,
      cacheReadInputTokens: 100 * CACHE_COLD_RATIO,
      cacheCreationInputTokens: 0,
    };
    expect(auditCacheHit(justCold).cold).toBe(true);
  });
});

describe('CacheAuditor (rolling per-loop)', () => {
  it('detects degradation only after a warm baseline is established', () => {
    const auditor = new CacheAuditor();
    // cold start — expected, not degraded
    expect(auditor.record('loop-a', cold()).degraded).toBe(false);
    // warms up
    expect(auditor.record('loop-a', warm()).degraded).toBe(false);
    expect(auditor.baselineFor('loop-a')).toBeCloseTo(0.9, 10);
    // a prompt/tool change collapses the cache mid-life → degradation
    expect(auditor.record('loop-a', cold()).degraded).toBe(true);
  });

  it('tracks loops independently', () => {
    const auditor = new CacheAuditor();
    auditor.record('loop-a', warm());
    // loop-b has no baseline yet → cold start, not degraded
    expect(auditor.record('loop-b', cold()).degraded).toBe(false);
  });
});

describe('assertCacheHit (Phase 2 contract preserved)', () => {
  it('still returns true iff cache reads > 0', () => {
    expect(assertCacheHit(warm())).toBe(true);
    expect(assertCacheHit(cold())).toBe(false);
  });
});
