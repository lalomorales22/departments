import { describe, expect, it } from 'vitest';
import {
  BudgetLedger,
  CACHE_READ_MULTIPLIER,
  costOfUsage,
  DEFAULT_SOFT_CAP_FRACTION,
  HAIKU_MODEL_ID,
  OPUS_MODEL_ID,
  SONNET_MODEL_ID,
  type ModelUsage,
  type UsageScope,
} from './ledger.js';

/** A plain prompt: only uncached input + output (no caching effects). */
function plainUsage(inputTokens: number, outputTokens: number): ModelUsage {
  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

const ORG = 'org_acme';

function scope(loopId: string, runId = 'run_1'): UsageScope {
  return { orgId: ORG, loopId, runId };
}

describe('costOfUsage — model tiering', () => {
  it('prices Opus input/output at $5/$25 per 1M', () => {
    // 1M input + 1M output on Opus = $5 + $25 = $30.
    expect(costOfUsage(plainUsage(1_000_000, 1_000_000), OPUS_MODEL_ID)).toBeCloseTo(30, 10);
  });

  it('Haiku is cheaper than Opus for the SAME tokens', () => {
    const usage = plainUsage(500_000, 200_000);
    const opus = costOfUsage(usage, OPUS_MODEL_ID);
    const haiku = costOfUsage(usage, HAIKU_MODEL_ID);
    expect(haiku).toBeLessThan(opus);
    // Haiku ($1/$5) is exactly 1/5 of Opus ($5/$25) — the README's ~5× claim.
    expect(opus / haiku).toBeCloseTo(5, 10);
  });

  it('Sonnet sits between Haiku and Opus', () => {
    const usage = plainUsage(400_000, 300_000);
    const haiku = costOfUsage(usage, HAIKU_MODEL_ID);
    const sonnet = costOfUsage(usage, SONNET_MODEL_ID);
    const opus = costOfUsage(usage, OPUS_MODEL_ID);
    expect(sonnet).toBeGreaterThan(haiku);
    expect(sonnet).toBeLessThan(opus);
  });
});

describe('costOfUsage — cache reads reduce cost ~10x', () => {
  it('a cache-read token costs 0.1x an uncached input token', () => {
    const tokens = 1_000_000;
    const uncached = costOfUsage(plainUsage(tokens, 0), OPUS_MODEL_ID);
    const cached = costOfUsage(
      { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: tokens, cacheCreationInputTokens: 0 },
      OPUS_MODEL_ID,
    );
    expect(cached).toBeCloseTo(uncached * CACHE_READ_MULTIPLIER, 12);
    // Reading from cache instead of full input is a 10x reduction on that bucket.
    expect(uncached / cached).toBeCloseTo(10, 10);
  });
});

describe('BudgetLedger — caps and signals', () => {
  it('soft cap (80%) returns "downgrade"', () => {
    const ledger = new BudgetLedger();
    ledger.registerLoop({ orgId: ORG, loopId: 'loop_mkt', hardCapUsd: 100 });
    // softCap defaults to 80 (DEFAULT_SOFT_CAP_FRACTION × 100).
    expect(ledger.status('loop_mkt').softCapUsd).toBeCloseTo(
      100 * DEFAULT_SOFT_CAP_FRACTION,
      10,
    );

    // Spend $85 → at/over the $80 soft cap but under the $100 hard cap.
    // $85 on Opus output = 85 / 25 * 1M tokens. Use a direct usage that lands ~$85.
    ledger.recordUsage(scope('loop_mkt'), plainUsage(0, 3_400_000), OPUS_MODEL_ID); // 3.4M out * $25/1M = $85
    const status = ledger.status('loop_mkt');
    expect(status.spentUsd).toBeCloseTo(85, 6);
    expect(status.state).toBe('soft');
    expect(ledger.checkCap('loop_mkt')).toBe('downgrade');
  });

  it('hard cap returns "pause"', () => {
    const ledger = new BudgetLedger();
    ledger.registerLoop({ orgId: ORG, loopId: 'loop_seo', hardCapUsd: 100 });
    // Spend $120 → over hard cap. 4.8M output * $25/1M = $120.
    ledger.recordUsage(scope('loop_seo'), plainUsage(0, 4_800_000), OPUS_MODEL_ID);
    const status = ledger.status('loop_seo');
    expect(status.spentUsd).toBeCloseTo(120, 6);
    expect(status.state).toBe('hard');
    expect(ledger.checkCap('loop_seo')).toBe('pause');
  });

  it('stays "ok" below the soft cap', () => {
    const ledger = new BudgetLedger();
    ledger.registerLoop({ orgId: ORG, loopId: 'loop_calm', hardCapUsd: 100 });
    ledger.recordUsage(scope('loop_calm'), plainUsage(0, 1_000_000), OPUS_MODEL_ID); // $25
    expect(ledger.status('loop_calm').state).toBe('ok');
    expect(ledger.checkCap('loop_calm')).toBe('ok');
  });

  it('respects an explicit soft cap override', () => {
    const ledger = new BudgetLedger();
    ledger.registerLoop({ orgId: ORG, loopId: 'loop_tight', hardCapUsd: 100, softCapUsd: 40 });
    ledger.recordUsage(scope('loop_tight'), plainUsage(0, 2_000_000), OPUS_MODEL_ID); // $50
    expect(ledger.status('loop_tight').state).toBe('soft');
  });
});

describe('BudgetLedger — org rollup sums loop spend', () => {
  it('orgStatus sums spend across all loops in the org', () => {
    const ledger = new BudgetLedger();
    ledger.registerOrg({ orgId: ORG, hardCapUsd: 1000 });
    ledger.registerLoop({ orgId: ORG, loopId: 'loop_a', hardCapUsd: 500 });
    ledger.registerLoop({ orgId: ORG, loopId: 'loop_b', hardCapUsd: 500 });

    ledger.recordUsage(scope('loop_a'), plainUsage(0, 1_000_000), OPUS_MODEL_ID); // $25
    ledger.recordUsage(scope('loop_b'), plainUsage(0, 2_000_000), OPUS_MODEL_ID); // $50

    expect(ledger.status('loop_a').spentUsd).toBeCloseTo(25, 6);
    expect(ledger.status('loop_b').spentUsd).toBeCloseTo(50, 6);

    const org = ledger.orgStatus(ORG);
    expect(org.spentUsd).toBeCloseTo(75, 6); // 25 + 50
    expect(org.state).toBe('ok'); // 75 < 800 soft cap
  });

  it('org soft/hard cap trips on the rollup even when each loop is under its own cap', () => {
    const ledger = new BudgetLedger();
    ledger.registerOrg({ orgId: ORG, hardCapUsd: 100 }); // org soft cap = $80
    ledger.registerLoop({ orgId: ORG, loopId: 'loop_x', hardCapUsd: 1000 });
    ledger.registerLoop({ orgId: ORG, loopId: 'loop_y', hardCapUsd: 1000 });

    // Each loop spends $50 (well under its own $1000 cap) → org sees $100 (hard).
    ledger.recordUsage(scope('loop_x'), plainUsage(0, 2_000_000), OPUS_MODEL_ID);
    ledger.recordUsage(scope('loop_y'), plainUsage(0, 2_000_000), OPUS_MODEL_ID);

    expect(ledger.checkCap('loop_x')).toBe('ok');
    expect(ledger.checkCap('loop_y')).toBe('ok');
    expect(ledger.orgStatus(ORG).state).toBe('hard');
    expect(ledger.checkOrgCap(ORG)).toBe('pause');
  });

  it('recordUsage returns the cost added and accumulates across calls', () => {
    const ledger = new BudgetLedger();
    ledger.registerLoop({ orgId: ORG, loopId: 'loop_acc', hardCapUsd: 1000 });
    const first = ledger.recordUsage(scope('loop_acc'), plainUsage(0, 1_000_000), OPUS_MODEL_ID);
    const second = ledger.recordUsage(scope('loop_acc'), plainUsage(0, 1_000_000), OPUS_MODEL_ID);
    expect(first).toBeCloseTo(25, 6);
    expect(second).toBeCloseTo(25, 6);
    expect(ledger.status('loop_acc').spentUsd).toBeCloseTo(50, 6);
  });
});
