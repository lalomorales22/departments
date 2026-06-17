/**
 * The LOCAL composition root over the engine: wires the real git artifact store,
 * a memory store, the rubric library, and the budget ledger to {@link runCycle},
 * defaulting to the deterministic {@link FakeCmaRuntime} (swap in `CmaRuntime` when
 * `ANTHROPIC_API_KEY` is configured). The Temporal `LoopWorkflow` is the durable
 * equivalent; this one runs in-process for the CLI and the cockpit's run-a-loop route.
 */
import { FakeCmaRuntime, type LoopAgentRuntime } from '@departments/agent-runtime';
import { GitArtifactStore } from '@departments/artifacts';
import { FileMemoryStore, InMemoryMemoryStore } from '@departments/memory';
import { RubricLibrary } from '@departments/rubrics';
import { BudgetLedger } from '@departments/cost';
import type { DeptEvent } from '@departments/events';
import { bootstrap } from './bootstrap.js';
import { runCycle, type CycleResult, type EngineDeps, type LoopSpec } from './engine.js';
import { NoProgressDetector, type NoProgressConfig } from './no-progress.js';
import type { StepGate } from './step-gate.js';
import type { ArtifactPort, CapAction, LedgerPort, MemoryPort, PersistencePort, RunRecord } from './ports.js';

export interface RunLoopOptions {
  loopId: string;
  orgId?: string;
  mission?: string;
  /** How many cycles to run this invocation (default 1). */
  cycles?: number;
  /** Rework cap inside EXECUTE↔EVALUATE (default 2). */
  maxIterations?: number;
  /** Override the git artifacts root (else @departments/artifacts default). */
  artifactsRoot?: string;
  /** If set, persist memory as JSONL here; else in-memory. */
  memoryDir?: string;
  /** Hard budget cap for the loop in USD (default 1000). */
  budgetCapUsd?: number;
  /** Provider runtime; defaults to the local FakeCmaRuntime. */
  runtime?: LoopAgentRuntime;
  /** Per-role model/effort overrides. */
  roles?: LoopSpec['roles'];
  /** Stream sink for events (the CLI writes these as NDJSON). */
  onEvent?: (e: DeptEvent) => void;
  onRun?: (r: RunRecord) => void;
  /** Manual single-step gate (AUTO↔STEP); omit for auto-progress. */
  stepGate?: StepGate;
  /** No-progress detector tuning (H, health drop/recover). */
  noProgress?: NoProgressConfig;
}

const DEFAULT_ROLES: LoopSpec['roles'] = {
  planner: { modelId: 'claude-opus-4-8', effort: 'high' },
  executor: { modelId: 'claude-sonnet-4-6', effort: 'medium' },
  reviewer: { modelId: 'claude-opus-4-8', effort: 'high' },
  docs: { modelId: 'claude-sonnet-4-6', effort: 'medium' },
};

function seedsFor(loopId: string, mission: string): Record<string, string> {
  return {
    'README.md': `# loop ${loopId}\n\n${mission}\n`,
    'TASKS.md': `# TASKS\n\n_(refreshed by PLAN each cycle)_\n`,
  };
}

/** Adapt the real BudgetLedger to the engine's LedgerPort. */
function ledgerPort(budget: BudgetLedger): LedgerPort {
  type Scope = Parameters<BudgetLedger['recordUsage']>[0];
  type Usage = Parameters<BudgetLedger['recordUsage']>[1];
  return {
    recordUsage(scope, usage, modelId) {
      const s = { orgId: scope.orgId ?? 'org-local', loopId: scope.loopId, runId: scope.runId } as Scope;
      return { costUsd: budget.recordUsage(s, usage as Usage, modelId) };
    },
    checkCap(loopId) {
      return budget.checkCap(loopId) as CapAction;
    },
  };
}

function streamingPersistence(
  onEvent?: (e: DeptEvent) => void,
  onRun?: (r: RunRecord) => void,
): PersistencePort {
  const seqs = new Map<string, number>();
  return {
    nextSeq(loopId) {
      const n = seqs.get(loopId) ?? 0;
      seqs.set(loopId, n + 1);
      return n;
    },
    recordEvent(e) {
      onEvent?.(e);
    },
    recordRun(r) {
      onRun?.(r);
    },
  };
}

export interface RunLoopResult {
  results: CycleResult[];
  /** Absolute path to the loop's git working tree (where artifacts live). */
  workspaceDir: string;
  /** True when the no-progress detector auto-paused the loop (distinct from budget pause). */
  noProgressPaused: boolean;
  /** Final loop health (0–100) per the no-progress detector. */
  health: number;
}

export async function runLoopLocally(opts: RunLoopOptions): Promise<RunLoopResult> {
  const { loopId } = opts;
  const orgId = opts.orgId ?? 'org-local';
  const mission = opts.mission ?? `Run the ${loopId} department and improve every cycle.`;

  const artifacts: ArtifactPort = new GitArtifactStore({ root: opts.artifactsRoot });
  const { workspaceDir } = await artifacts.provision(loopId);
  const memory: MemoryPort = opts.memoryDir ? new FileMemoryStore(opts.memoryDir) : new InMemoryMemoryStore();
  const budget = new BudgetLedger();
  budget.registerLoop({ orgId, loopId, hardCapUsd: opts.budgetCapUsd ?? 1000 });

  // Observe metric movement per cycle (excluding the engine-emitted `health` metric
  // itself), tee'ing every event to the caller's NDJSON sink.
  let metricMovedThisCycle = false;
  const observe = (e: DeptEvent): void => {
    if (e.kind === 'metric' && e.payload.key !== 'health' && Math.abs(e.payload.delta) > 0) {
      metricMovedThisCycle = true;
    }
    opts.onEvent?.(e);
  };

  const persistence = streamingPersistence(observe, opts.onRun);
  const deps: EngineDeps = {
    runtime: opts.runtime ?? new FakeCmaRuntime(),
    artifacts,
    memory,
    rubrics: new RubricLibrary(),
    ledger: ledgerPort(budget),
    persistence,
    stepGate: opts.stepGate,
  };

  /** Emit a driver-level event on the same monotonic per-loop seq as the engine. */
  const emit = (e: Omit<DeptEvent, 'seq'>): void => {
    const stamped = { ...e, seq: persistence.nextSeq(loopId) } as DeptEvent;
    void persistence.recordEvent(stamped);
  };

  const seeds = seedsFor(loopId, mission);
  const boot = await bootstrap(loopId, artifacts, seeds);

  const detector = new NoProgressDetector(opts.noProgress);
  const results: CycleResult[] = [];
  const cycles = Math.max(1, opts.cycles ?? 1);
  let cycle = boot.cycle;
  let noProgressPaused = false;
  let driverSeq = 0;

  for (let i = 0; i < cycles; i += 1) {
    metricMovedThisCycle = false;
    const result = await runCycle(
      {
        loopId,
        orgId,
        mission,
        cycle,
        maxIterations: opts.maxIterations ?? 2,
        roles: opts.roles ?? DEFAULT_ROLES,
      },
      deps,
    );
    results.push(result);
    // Budget cap PRECEDENCE: a hard-cap pause halts before any no-progress logic.
    if (result.paused) break;

    // No-progress detection runs at the cycle boundary on a cleanly-completed cycle.
    const meaningful = result.snapshots.some((s) => s.meaningful);
    const outcome = detector.record({ meaningful, metricMoved: metricMovedThisCycle });
    const ts = new Date().toISOString();
    const runId = result.runId;
    emit({
      id: `${runId}-health-${driverSeq++}`,
      loopId,
      runId,
      ts,
      kind: 'metric',
      payload: {
        key: 'health',
        name: 'Loop Health',
        value: outcome.health,
        display: `${outcome.health}%`,
        delta: outcome.stalled ? -1 : 1,
        goodDirection: 'up',
        unit: 'percent',
      },
    });
    if (outcome.shouldPause) {
      noProgressPaused = true;
      emit({
        id: `${runId}-noprogress`,
        loopId,
        runId,
        ts,
        kind: 'log',
        payload: {
          level: 'error',
          source: 'guardrail',
          message: `no-progress detector: ${outcome.consecutiveStalls} cycle(s) with no meaningful diff or metric movement — auto-pausing (health ${outcome.health}%).`,
        },
      });
      emit({
        id: `${runId}-noprogress-pause`,
        loopId,
        runId,
        ts,
        kind: 'status',
        payload: { scope: 'loop', targetId: loopId, loopStatus: 'paused' },
      });
      break;
    }
    cycle += 1;
  }
  return { results, workspaceDir, noProgressPaused, health: detector.health };
}
