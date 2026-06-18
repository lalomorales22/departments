import { describe, expect, it } from 'vitest';
import { FakeCmaRuntime } from '@departments/agent-runtime';
import { DEFAULT_GATE_THRESHOLDS, HealthController } from '@departments/rubrics';
import type { Alert } from '@departments/shared';
import { runCycle, type EngineDeps, type LoopSpec } from './engine.js';
import { InMemoryCleanup } from './cleanup.js';
import {
  makeLedger,
  makeMemoryStore,
  makePersistence,
  makeRubrics,
  makeTempArtifacts,
} from './in-memory.js';

function makeSpec(over: Partial<LoopSpec> = {}): LoopSpec {
  return {
    loopId: 'loop-gate',
    orgId: 'org-test',
    mission: 'Enforce the four gates.',
    cycle: 1,
    maxIterations: 2,
    roles: {
      planner: { modelId: 'claude-opus-4-8', effort: 'high' },
      executor: { modelId: 'claude-sonnet-4-6', effort: 'medium' },
      reviewer: { modelId: 'claude-opus-4-8', effort: 'high' },
      docs: { modelId: 'claude-sonnet-4-6', effort: 'medium' },
    },
    ...over,
  };
}

async function harness(over: Partial<EngineDeps> = {}) {
  const artifacts = makeTempArtifacts();
  await artifacts.provision('loop-gate');
  await artifacts.seedIfEmpty('loop-gate', { 'README.md': '# loop-gate\n', 'TASKS.md': '# TASKS\n' });
  const persistence = makePersistence();
  const alerts: Alert[] = [];
  const deps: EngineDeps = {
    runtime: new FakeCmaRuntime(),
    artifacts,
    memory: makeMemoryStore(),
    rubrics: makeRubrics(),
    ledger: makeLedger(),
    persistence,
    alerts: (a) => alerts.push(a),
    ...over,
  };
  return { deps, persistence, alerts };
}

const healthMetric = (p: { events: { kind: string; payload: unknown }[] }) =>
  p.events.filter((e) => e.kind === 'metric' && (e.payload as { key: string }).key === 'health');

describe('four gates enforced + rolling health', () => {
  it('computes rolling health, emits a health metric, and runs IMPROVE when gates clear', async () => {
    const { deps, persistence } = await harness();
    const result = await runCycle(makeSpec(), deps);

    // All four gates clear after the one rework → 100% health.
    expect(result.gates).toHaveLength(4);
    expect(result.health).toBe(100);
    expect(result.gateBlocked).toBe(false);
    expect(result.phasesRun).toContain('improve');

    // The canonical health metric was emitted at the cycle boundary.
    const metrics = healthMetric(persistence);
    expect(metrics).toHaveLength(1);
    expect((metrics[0]!.payload as { value: number }).value).toBe(100);
  });

  it('a tightened threshold raises a barrier that SKIPS IMPROVE (Performance→IMPROVE)', async () => {
    const { deps } = await harness({
      // The grader passes performance at ~88-97; a 99 floor fails it → barrier.
      gateConfig: { ...DEFAULT_GATE_THRESHOLDS, performance: { minScore: 99, required: true } },
    });
    const result = await runCycle(makeSpec(), deps);
    expect(result.gateBlocked).toBe(true);
    expect(result.phasesRun).not.toContain('improve');
    // performance failed its floor → 3/4 gates clear → health 75.
    expect(result.health).toBe(75);
    // MEMORY still ran (the failed cycle is recorded).
    expect(result.phasesRun).toContain('memory');
  });

  it('health DROPS on a stalled cycle (no meaningful diff fails quality + alignment)', async () => {
    const { deps } = await harness({ runtime: new FakeCmaRuntime({ stall: true }) });
    const result = await runCycle(makeSpec(), deps);
    // After the bounded rework the grader fixes performance, but quality + alignment stay
    // failed (no meaningful diff) → 2/4 gates clear → health 50, and the barrier blocks.
    expect(result.health).toBe(50);
    expect(result.gateBlocked).toBe(true);
    expect(result.phasesRun).not.toContain('improve');
  });

  it('threads health across cycles via an injected HealthController', async () => {
    const health = new HealthController();
    // Cycle 1: a stalled cycle drops health.
    const a = await harness({ runtime: new FakeCmaRuntime({ stall: true }), health });
    const r1 = await runCycle(makeSpec({ cycle: 1 }), a.deps);
    // Cycle 2: a clean cycle pulls the rolling average back up but not all the way.
    const b = await harness({ runtime: new FakeCmaRuntime(), health });
    const r2 = await runCycle(makeSpec({ cycle: 2 }), b.deps);
    expect(r2.health).toBeGreaterThan(r1.health);
    expect(r2.health).toBeLessThan(100); // the prior stall still weighs on the window
  });

  it('records a cleanup archive at the cycle boundary', async () => {
    const cleanup = new InMemoryCleanup();
    const { deps } = await harness({ cleanup });
    await runCycle(makeSpec(), deps);
    expect(cleanup.archived).toHaveLength(1);
    expect(cleanup.archived[0]!.reason).toBe('completed');
  });
});

describe('Phase 5 alerts', () => {
  it('raises a critical budget_breach alert on a hard-cap pause', async () => {
    const { deps, alerts } = await harness({ ledger: makeLedger({ hardCapUsd: 0.00001 }) });
    const result = await runCycle(makeSpec(), deps);
    expect(result.paused).toBe(true);
    expect(alerts.some((a) => a.kind === 'budget_breach' && a.severity === 'critical')).toBe(true);
  });

  it('downgrades an unapproved Fable role to Opus and raises fable_approval_required', async () => {
    const { deps, alerts, persistence } = await harness();
    const result = await runCycle(
      makeSpec({
        roles: {
          planner: { modelId: 'claude-fable-5', effort: 'xhigh' },
          executor: { modelId: 'claude-sonnet-4-6', effort: 'medium' },
          reviewer: { modelId: 'claude-opus-4-8', effort: 'high' },
          docs: { modelId: 'claude-sonnet-4-6', effort: 'medium' },
        },
        fableApproved: false,
      }),
      deps,
    );
    expect(result.paused).toBe(false);
    expect(alerts.some((a) => a.kind === 'fable_approval_required')).toBe(true);
    const logs = persistence.events.filter((e) => e.kind === 'log').map((e) => (e.payload as { message: string }).message);
    expect(logs.some((m) => m.includes('fable-approval-required'))).toBe(true);
  });

  it('does not downgrade Fable when approved', async () => {
    const { deps, alerts } = await harness();
    await runCycle(
      makeSpec({
        roles: {
          planner: { modelId: 'claude-fable-5', effort: 'xhigh' },
          executor: { modelId: 'claude-sonnet-4-6', effort: 'medium' },
          reviewer: { modelId: 'claude-opus-4-8', effort: 'high' },
          docs: { modelId: 'claude-sonnet-4-6', effort: 'medium' },
        },
        fableApproved: true,
      }),
      deps,
    );
    expect(alerts.some((a) => a.kind === 'fable_approval_required')).toBe(false);
  });
});
