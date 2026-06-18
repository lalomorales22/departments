import { describe, expect, it } from 'vitest';
import type { DeptEvent } from '@departments/events';
import { costOfUsage } from '@departments/cost';
import { planObjectives, setObjective, runCeoReview, type ChildState, type SetObjectiveDeps } from './ceo.js';
import { makeMemoryStore } from './in-memory.js';
import type { ArtifactPort } from './ports.js';

/** A per-loop in-memory ArtifactPort (isolates STRATEGY.md by loopId, unlike the temp-dir fake). */
function memArtifacts(): ArtifactPort {
  const fs = new Map<string, Map<string, string>>();
  const of = (id: string) => fs.get(id) ?? (fs.set(id, new Map()), fs.get(id)!);
  return {
    async provision(id) {
      of(id);
      return { workspaceDir: `/mem/${id}` };
    },
    async seedIfEmpty(id, seeds) {
      const m = of(id);
      for (const [k, v] of Object.entries(seeds)) if (!m.has(k)) m.set(k, v);
    },
    async read(id, rel) {
      return of(id).get(rel) ?? null;
    },
    async write(id, rel, content) {
      of(id).set(rel, content);
    },
    async snapshot() {
      return { sha: 'mem', version: 'v1', changedFiles: [], meaningful: false };
    },
  };
}

function child(over: Partial<ChildState> & { loopId: string }): ChildState {
  return {
    orgId: 'org',
    name: over.loopId,
    mission: 'm',
    level: 2,
    health: 85,
    status: 'running',
    spentUsd: 10,
    budgetCapUsd: 100,
    ...over,
  };
}

describe('planObjectives (pure)', () => {
  it('classifies units by status/health', () => {
    const objs = planObjectives([
      child({ loopId: 'a', status: 'paused' }),
      child({ loopId: 'b', health: 50 }),
      child({ loopId: 'c', health: 95 }),
      child({ loopId: 'd', health: 80 }),
    ]);
    expect(objs.find((o) => o.loopId === 'a')!.objective).toMatch(/Stabilize/);
    expect(objs.find((o) => o.loopId === 'b')!.objective).toMatch(/Recover/);
    expect(objs.find((o) => o.loopId === 'c')!.objective).toMatch(/Scale/);
    expect(objs.find((o) => o.loopId === 'd')!.objective).toMatch(/Hold course/);
  });

  it('reallocates budget net-zero from the weakest to the strongest unit', () => {
    const objs = planObjectives(
      [
        child({ loopId: 'strong', status: 'running', health: 95 }),
        child({ loopId: 'weak', status: 'paused', health: 40 }),
      ],
      { reallocateUsd: 50 },
    );
    expect(objs.find((o) => o.loopId === 'strong')!.budgetDeltaUsd).toBe(50);
    expect(objs.find((o) => o.loopId === 'weak')!.budgetDeltaUsd).toBe(-50);
    expect(objs.reduce((s, o) => s + o.budgetDeltaUsd, 0)).toBe(0); // net-zero
  });
});

describe('setObjective (effect)', () => {
  it('writes STRATEGY.md, seeds memory, adjusts the cap, and emits an objective event', async () => {
    const artifacts = memArtifacts();
    await artifacts.provision('loop-child');
    const memory = makeMemoryStore();
    const events: DeptEvent[] = [];
    let cap = 0;
    const deps: SetObjectiveDeps = {
      artifacts,
      memory,
      ledger: { registerLoop: (c) => { cap = c.hardCapUsd; } },
      emit: (e) => events.push({ ...e, seq: events.length } as DeptEvent),
      clock: { now: () => '2026-06-17T00:00:00Z' },
    };
    const c = child({ loopId: 'loop-child', budgetCapUsd: 100, spentUsd: 20 });
    const { newBudgetCapUsd } = await setObjective(
      c,
      { loopId: 'loop-child', objective: 'Scale up', budgetDeltaUsd: 50, rationale: 'strong' },
      deps,
      'evt-1',
    );
    expect(newBudgetCapUsd).toBe(150);
    expect(cap).toBe(150);
    expect(await artifacts.read('loop-child', 'STRATEGY.md')).toMatch(/set by CEO/);
    expect(memory.all().some((m) => m.summary.includes('CEO objective'))).toBe(true);
    const ev = events.find((e) => e.kind === 'log' && e.payload.source === 'objective');
    expect(ev).toBeTruthy();
  });

  it('floors the new cap at current spend (never strands a loop below its spend)', async () => {
    const artifacts = memArtifacts();
    await artifacts.provision('loop-c2');
    const deps: SetObjectiveDeps = { artifacts, emit: () => {} };
    const c = child({ loopId: 'loop-c2', budgetCapUsd: 100, spentUsd: 80 });
    const { newBudgetCapUsd } = await setObjective(
      c,
      { loopId: 'loop-c2', objective: 'Reclaim', budgetDeltaUsd: -50, rationale: 'weak' },
      deps,
      'evt-2',
    );
    expect(newBudgetCapUsd).toBe(80); // 100 - 50 = 50, but floored at spent (80)
  });
});

describe('runCeoReview — Batch API path (50% off)', () => {
  it('grades children via batch, prices the review at half, and applies objectives', async () => {
    const artifacts = memArtifacts();
    await artifacts.provision('loop-ceo');
    await artifacts.provision('strong');
    await artifacts.provision('weak');
    const memory = makeMemoryStore();
    const events: DeptEvent[] = [];
    const result = await runCeoReview(
      'loop-ceo',
      [
        child({ loopId: 'strong', status: 'running', health: 95 }),
        child({ loopId: 'weak', status: 'paused', health: 45 }),
      ],
      { artifacts, memory, emit: (e) => events.push({ ...e, seq: events.length } as DeptEvent), clock: { now: () => '2026-06-17T00:00:00Z' } },
      { reallocateUsd: 25 },
    );

    expect(result.verdicts).toHaveLength(2);
    expect(result.objectives).toHaveLength(2);
    expect(result.reviewCostUsd).toBeGreaterThan(0);

    // The review was BATCHED → exactly half the synchronous price for the same usage.
    const syncCost = result.verdicts.reduce((s, v) => s + costOfUsage(v.usage, 'claude-opus-4-8'), 0);
    expect(result.reviewCostUsd).toBeCloseTo(syncCost / 2, 9);

    // A CEO summary event + per-child objective events landed.
    expect(events.some((e) => e.kind === 'log' && e.payload.source === 'ceo')).toBe(true);
    expect(events.filter((e) => e.kind === 'log' && e.payload.source === 'objective')).toHaveLength(2);
    expect(await artifacts.read('strong', 'STRATEGY.md')).toMatch(/Scale/);
  });
});
