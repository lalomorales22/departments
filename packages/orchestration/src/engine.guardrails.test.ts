import { describe, expect, it } from 'vitest';
import { FakeCmaRuntime } from '@departments/agent-runtime';
import { runCycle, type EngineDeps, type LoopSpec } from './engine.js';
import type { LedgerPort } from './ports.js';
import { denyToolGate, autoApproveToolGate } from './tool-gate.js';
import {
  makeMemoryStore,
  makePersistence,
  makeRubrics,
  makeTempArtifacts,
} from './in-memory.js';

const INF = Number.POSITIVE_INFINITY;

/** A fully-stubbed ledger so each precedence test pins the exact cap signals. */
function stubLedger(over: Partial<LedgerPort> = {}): LedgerPort {
  return {
    recordUsage: () => ({ costUsd: 0.01 }),
    checkCap: () => 'ok',
    checkOrgCap: () => 'ok',
    headroomUsd: () => INF,
    orgHeadroomUsd: () => INF,
    ...over,
  };
}

function makeSpec(over: Partial<LoopSpec> = {}): LoopSpec {
  return {
    loopId: 'loop-g',
    orgId: 'org-g',
    mission: 'Guardrail test loop.',
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

async function depsWith(over: Partial<EngineDeps>) {
  const artifacts = makeTempArtifacts();
  await artifacts.provision('loop-g');
  await artifacts.seedIfEmpty('loop-g', { 'README.md': '# loop-g\n', 'TASKS.md': '# TASKS\n' });
  const persistence = makePersistence();
  const deps: EngineDeps = {
    runtime: new FakeCmaRuntime(),
    artifacts,
    memory: makeMemoryStore(),
    rubrics: makeRubrics(),
    ledger: stubLedger(),
    persistence,
    ...over,
  };
  return { deps, persistence };
}

const logs = (p: { events: { kind: string; payload: unknown }[] }) =>
  p.events.filter((e) => e.kind === 'log').map((e) => (e.payload as { message: string }).message);

describe('org-wide budget cap precedence', () => {
  it('pauses a loop under its OWN cap when the ORG rollup cap is breached', async () => {
    const { deps, persistence } = await depsWith({
      ledger: stubLedger({ checkCap: () => 'ok', checkOrgCap: () => 'pause', orgHeadroomUsd: () => 0 }),
    });
    const result = await runCycle(makeSpec(), deps);
    expect(result.paused).toBe(true);
    // The pause was ORG-driven (the loop's own cap stayed ok).
    expect(logs(persistence).some((m) => m.includes('org-wide hard budget cap'))).toBe(true);
  });

  it('does not pause when both caps are ok', async () => {
    const { deps } = await depsWith({});
    const result = await runCycle(makeSpec(), deps);
    expect(result.paused).toBe(false);
  });
});

describe('always_ask irreversible-tool gate', () => {
  it('denies an irreversible deploy, flags toolDenied, and does NOT pause (reroute)', async () => {
    const { deps, persistence } = await depsWith({
      runtime: new FakeCmaRuntime({ irreversible: { tool: 'github.deploy', summary: 'deploy to prod' } }),
      toolGate: denyToolGate('no approver attached'),
    });
    const result = await runCycle(makeSpec(), deps);
    expect(result.toolDenied).toBe(true);
    expect(result.paused).toBe(false); // a denial reroutes; it never pauses the loop
    const denied = persistence.events.find(
      (e) => e.kind === 'tool_use' && (e.payload as { tool: string; phase: string }).phase === 'error',
    );
    expect(denied).toBeTruthy();
    expect(logs(persistence).some((m) => m.includes('DENIED'))).toBe(true);
  });

  it('approves an irreversible deploy when the gate allows it', async () => {
    const { deps, persistence } = await depsWith({
      runtime: new FakeCmaRuntime({ irreversible: { tool: 'github.deploy', summary: 'deploy to prod' } }),
      toolGate: autoApproveToolGate,
    });
    const result = await runCycle(makeSpec(), deps);
    expect(result.toolDenied).toBe(false);
    const ok = persistence.events.find(
      (e) =>
        e.kind === 'tool_use' &&
        (e.payload as { tool: string; phase: string; summary: string }).phase === 'result' &&
        (e.payload as { summary: string }).summary.startsWith('approved'),
    );
    expect(ok).toBeTruthy();
  });
});

describe('escalation is subordinate to budget caps', () => {
  it('escalates the rework executor when the cap is ok and headroom is sufficient', async () => {
    const { deps, persistence } = await depsWith({}); // ok cap, infinite headroom
    const result = await runCycle(makeSpec(), deps);
    expect(result.reworks).toBe(1); // FakeCmaRuntime fails the perf gate once
    expect(result.escalated).toBe(true);
    expect(logs(persistence).some((m) => m.startsWith('escalation: rework 1 →'))).toBe(true);
  });

  it('REFUSES escalation when the soft cap has tripped (downgrade wins)', async () => {
    const { deps, persistence } = await depsWith({
      ledger: stubLedger({ checkCap: () => 'downgrade' }),
    });
    const result = await runCycle(makeSpec(), deps);
    expect(result.reworks).toBe(1);
    expect(result.escalated).toBe(false);
    expect(result.downgraded).toBe(true);
    expect(logs(persistence).some((m) => m.includes('escalation refused'))).toBe(true);
  });

  it('REFUSES escalation when the bump would not fit the hard-cap headroom', async () => {
    const { deps, persistence } = await depsWith({
      ledger: stubLedger({ headroomUsd: () => 0.0005 }), // far below a projected escalated call
    });
    const result = await runCycle(makeSpec(), deps);
    expect(result.escalated).toBe(false);
    expect(logs(persistence).some((m) => m.includes('escalation refused'))).toBe(true);
  });
});
