import { describe, expect, it } from 'vitest';
import {
  BudgetLedger,
  FABLE_MODEL_ID,
  OPUS_MODEL_ID,
  batchSavings,
  projectedCycleUsd,
  requiresFableApproval,
  type ModelUsage,
  type UsageScope,
} from './ledger.js';

function plainUsage(inputTokens: number, outputTokens: number): ModelUsage {
  return { inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
}
const ORG = 'org_acme';
function scope(loopId: string, runId = 'run_1'): UsageScope {
  return { orgId: ORG, loopId, runId };
}

describe('batchSavings', () => {
  it('reports sync, batch (50%), and the saving', () => {
    const usage = plainUsage(1_000_000, 1_000_000); // Opus: $30 sync
    const s = batchSavings(usage, OPUS_MODEL_ID);
    expect(s.syncCostUsd).toBeCloseTo(30, 6);
    expect(s.batchCostUsd).toBeCloseTo(15, 6);
    expect(s.savingUsd).toBeCloseTo(15, 6);
  });
});

describe('requiresFableApproval (Fable-5 cost gate)', () => {
  it('gates the Fable path (reserved, behind explicit approval)', () => {
    expect(requiresFableApproval(FABLE_MODEL_ID)).toBe(true);
  });
  it('never gates non-Fable models', () => {
    expect(requiresFableApproval(OPUS_MODEL_ID)).toBe(false);
  });
  it('projects a cycle cost for the approval prompt (Fable > Opus)', () => {
    expect(projectedCycleUsd(FABLE_MODEL_ID)).toBeGreaterThan(projectedCycleUsd(OPUS_MODEL_ID));
  });
});

describe('BudgetLedger.orgReport (per-org dashboard)', () => {
  it('aggregates org spend + per-loop breakdown sorted biggest-first', () => {
    const ledger = new BudgetLedger();
    ledger.registerOrg({ orgId: ORG, hardCapUsd: 100 });
    ledger.registerLoop({ orgId: ORG, loopId: 'loop-a', hardCapUsd: 60 });
    ledger.registerLoop({ orgId: ORG, loopId: 'loop-b', hardCapUsd: 60 });
    // loop-a spends more than loop-b
    ledger.recordUsage(scope('loop-a'), plainUsage(2_000_000, 0), OPUS_MODEL_ID); // $10
    ledger.recordUsage(scope('loop-b'), plainUsage(1_000_000, 0), OPUS_MODEL_ID); // $5

    const report = ledger.orgReport(ORG);
    expect(report.spentUsd).toBeCloseTo(15, 6);
    expect(report.hardCapUsd).toBe(100);
    expect(report.capped).toBe(true);
    expect(report.utilization).toBeCloseTo(0.15, 6);
    expect(report.state).toBe('ok');
    expect(report.loops.map((l) => l.loopId)).toEqual(['loop-a', 'loop-b']);
    expect(report.loops[0]!.pctOfOrgSpend).toBeCloseTo(10 / 15, 6);
  });

  it('an uncapped org reports capped=false and utilization 0', () => {
    const ledger = new BudgetLedger();
    ledger.registerLoop({ orgId: ORG, loopId: 'loop-a', hardCapUsd: 0 });
    ledger.recordUsage(scope('loop-a'), plainUsage(1_000_000, 0), OPUS_MODEL_ID);
    const report = ledger.orgReport(ORG);
    expect(report.capped).toBe(false);
    expect(report.utilization).toBe(0);
    expect(report.headroomUsd).toBe(Number.POSITIVE_INFINITY);
  });

  it('flags org soft/hard state as spend rises', () => {
    const ledger = new BudgetLedger();
    ledger.registerOrg({ orgId: ORG, hardCapUsd: 10 }); // soft = $8
    ledger.registerLoop({ orgId: ORG, loopId: 'loop-a', hardCapUsd: 100 });
    ledger.recordUsage(scope('loop-a'), plainUsage(1_800_000, 0), OPUS_MODEL_ID); // $9 → soft
    expect(ledger.orgReport(ORG).state).toBe('soft');
    ledger.recordUsage(scope('loop-a', 'run_2'), plainUsage(400_000, 0), OPUS_MODEL_ID); // +$2 → $11 → hard
    expect(ledger.orgReport(ORG).state).toBe('hard');
  });
});
