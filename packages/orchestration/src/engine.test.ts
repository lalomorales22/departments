import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeCmaRuntime } from '@departments/agent-runtime';
import { runCycle, type EngineDeps, type LoopSpec } from './engine.js';
import { bootstrap } from './bootstrap.js';
import type { LedgerPort } from './ports.js';
import {
  makeLedger,
  makeMemoryStore,
  makePersistence,
  makeRubrics,
  makeTempArtifacts,
} from './in-memory.js';

function makeSpec(cycle: number): LoopSpec {
  return {
    loopId: 'loop-sb',
    orgId: 'org-test',
    mission: 'Ship clean, tested, production-ready code.',
    cycle,
    maxIterations: 2,
    roles: {
      planner: { modelId: 'claude-opus-4-8', effort: 'high' },
      executor: { modelId: 'claude-sonnet-4-6', effort: 'medium' },
      reviewer: { modelId: 'claude-opus-4-8', effort: 'high' },
      docs: { modelId: 'claude-sonnet-4-6', effort: 'medium' },
    },
  };
}

const SEEDS = { 'README.md': '# loop-sb\nClean tested code.\n', 'TASKS.md': '# TASKS\n' };

async function harness(opts: { hardCapUsd?: number; ledger?: LedgerPort } = {}) {
  const artifacts = makeTempArtifacts();
  const memory = makeMemoryStore();
  const persistence = makePersistence();
  const ledger = opts.ledger ?? makeLedger({ hardCapUsd: opts.hardCapUsd });
  const deps: EngineDeps = {
    runtime: new FakeCmaRuntime(),
    artifacts,
    memory,
    rubrics: makeRubrics(),
    ledger,
    persistence,
  };
  await artifacts.provision('loop-sb');
  await artifacts.seedIfEmpty('loop-sb', SEEDS);
  return { artifacts, memory, persistence, ledger, deps };
}

/** A ledger that pauses on the Nth recordUsage call — to trip a breach at a chosen phase. */
function makeLedgerPausingOnCall(n: number): LedgerPort {
  let calls = 0;
  return {
    recordUsage() {
      calls += 1;
      return { costUsd: 0.01 };
    },
    checkCap() {
      return calls >= n ? 'pause' : 'ok';
    },
    checkOrgCap() {
      return 'ok';
    },
    headroomUsd() {
      return Number.POSITIVE_INFINITY;
    },
    orgHeadroomUsd() {
      return Number.POSITIVE_INFINITY;
    },
  };
}

describe('runCycle — a full real cycle', () => {
  it('runs PLAN→EXECUTE↔EVALUATE(rework)→IMPROVE→MEMORY and produces real artifacts', async () => {
    const { artifacts, memory, persistence, deps } = await harness();
    const result = await runCycle(makeSpec(1), deps);

    // IMPROVE iteration: performance gate fails once, then passes.
    expect(result.reworks).toBe(1);
    expect(result.finalVerdict?.result).toBe('satisfied');
    expect(result.paused).toBe(false);

    // EXECUTE ran twice (baseline + rework); plan/improve/memory once each.
    const execs = result.phasesRun.filter((p) => p === 'execute');
    expect(execs.length).toBe(2);
    expect(result.phasesRun).toContain('plan');
    expect(result.phasesRun).toContain('improve');
    expect(result.phasesRun).toContain('memory');

    // EVALUATE recorded twice in the audit spine (Runs).
    expect(persistence.runs.filter((r) => r.phase === 'evaluate').length).toBe(2);

    // Real files written into the git working tree.
    const handoff = await readFile(join(artifacts.dir(), 'HANDOFF.md'), 'utf8');
    expect(handoff).toMatch(/Cycle:\s*1/);
    const report = await readFile(join(artifacts.dir(), 'REPORT.md'), 'utf8');
    expect(report).toMatch(/Cycle 1/);

    // MEMORY distilled exactly one insight the next PLAN can read.
    expect(memory.all().length).toBe(1);

    // The grader scored a meaningful diff (not just HANDOFF churn).
    expect(result.snapshots.some((s) => s.meaningful)).toBe(true);

    // Cost accrued; cold cycle has no cache reads.
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.cacheReadTokens).toBe(0);
  });

  it('emits a well-formed event stream with monotonic per-loop seq', async () => {
    const { persistence, deps } = await harness();
    await runCycle(makeSpec(1), deps);
    const seqs = persistence.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length); // unique
    expect(seqs[0]).toBe(0);
    const kinds = new Set(persistence.events.map((e) => e.kind));
    for (const k of ['status', 'log', 'agent_msg', 'metric', 'debug']) expect(kinds.has(k as never)).toBe(true);
  });

  it('hits the prompt cache on a warm cycle (cycle > 1)', async () => {
    const { deps } = await harness();
    const result = await runCycle(makeSpec(2), deps);
    expect(result.cacheReadTokens).toBeGreaterThan(0);
  });

  it('PAUSES the loop when the hard budget cap is breached (precedence over work)', async () => {
    const { deps } = await harness({ hardCapUsd: 0.00001 });
    const result = await runCycle(makeSpec(1), deps);
    expect(result.paused).toBe(true);
    expect(result.phasesRun.length).toBeLessThan(5);
  });

  it('a pause DURING memory rolls back the resume cursor (re-runs the same cycle)', async () => {
    // Phase order with one rework: plan, execute, evaluate, execute(rework), evaluate,
    // improve, memory → the 7th usage record is MEMORY. Tripping there must not leave a
    // "completed" handoff that lets the next bootstrap skip the cycle.
    const { artifacts, memory, deps } = await harness({ ledger: makeLedgerPausingOnCall(7) });
    const result = await runCycle(makeSpec(1), deps);
    expect(result.paused).toBe(true);
    expect(result.phasesRun).toContain('memory'); // memory ran before the breach was detected
    expect(memory.all().length).toBe(0); // the distilled insight is NOT persisted on pause
    // HANDOFF was rolled back (cold start → removed), so the next bootstrap re-runs cycle 1.
    const boot = await bootstrap('loop-sb', artifacts, SEEDS);
    expect(boot.cycle).toBe(1);
  });

  it('resumes from HANDOFF.md on the next bootstrap', async () => {
    const { artifacts, deps } = await harness();
    await runCycle(makeSpec(1), deps);
    const boot = await bootstrap('loop-sb', artifacts, SEEDS);
    expect(boot.resumed).toBe(true);
    expect(boot.cycle).toBe(2);
  });
});
