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
import { HealthController, RubricLibrary, type GateThresholdConfig } from '@departments/rubrics';
import { BudgetLedger, CacheAuditor } from '@departments/cost';
import type { DeptEvent } from '@departments/events';
import { makeAlert, type AlertSink, type Loop, type LoopLevel, type LoopStatus, type LoopTreeNode } from '@departments/shared';
import { bootstrap } from './bootstrap.js';
import { runCycle, type CycleResult, type EngineDeps, type LoopSpec } from './engine.js';
import { NoProgressDetector, type NoProgressConfig } from './no-progress.js';
import type { StepGate } from './step-gate.js';
import { EscalationController } from './escalation.js';
import type { ToolGate } from './tool-gate.js';
import { InMemorySemaphore, type ConcurrencySemaphore } from './semaphore.js';
import { CadenceController } from './cadence.js';
import { rollup, type RollupNode } from './rollup.js';
import { runCeoReview, type ChildState, type CeoReviewResult } from './ceo.js';
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
  /**
   * Shared budget ledger (so a whole tree's spend rolls up to one org cap). Omit to use a
   * private per-run ledger. {@link runTreeLocally} passes one shared ledger to every loop.
   */
  ledger?: BudgetLedger;
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
  /**
   * Org-wide HARD budget cap in USD. When set, the org rollup cap is enforced
   * alongside the per-loop cap (the engine takes the stricter) — a tree of loops each
   * under its own cap can still pause when their combined spend breaches this.
   */
  orgBudgetCapUsd?: number;
  /**
   * `always_ask` gate for irreversible tools. Omit to auto-approve (legacy behavior).
   * Pair with a runtime that raises tool confirmations (see FakeCmaRuntime `irreversible`).
   */
  toolGate?: ToolGate;
  /**
   * Escalation controller, threaded across this invocation's cycles so decay persists.
   * Omit to create a fresh one (still threaded across the cycles run here).
   */
  escalation?: EscalationController;
  /** Per-org concurrency semaphore (runaway guard); omit for unbounded single-loop runs. */
  semaphore?: ConcurrencySemaphore;
  /**
   * Cadence label (e.g. "continuous", "hourly", "manual"). When set together with
   * `sleep`, the driver enforces the tier's floor BETWEEN cycles (a faster tick waits).
   * Omit `sleep` to skip the wait (CLI/tests stay fast) while still recording ticks.
   */
  cadence?: string;
  /** Shared cadence controller (cross-run tick memory); omit to use a per-run one. */
  cadenceController?: CadenceController;
  /** Injected clock for cadence math (ms). Default `Date.now`. */
  now?: () => number;
  /** Injected sleep for cadence floors; omit to record ticks without waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Configurable four-gate thresholds (Phase 5). Omit for the default 60/100 bar. */
  gateConfig?: GateThresholdConfig;
  /** Approve the gated Fable-5 cost path for this loop. Default false ⇒ downgrade to Opus. */
  fableApproved?: boolean;
  /** Alert sink for operational hazards (budget/gate/cache/Fable/no-progress). */
  alerts?: AlertSink;
  /** Rolling gate-pass HealthController, threaded across cycles. Omit for a fresh one. */
  health?: HealthController;
  /** Prompt-cache auditor, threaded across cycles (mid-life degradation). Omit for a fresh one. */
  cacheAuditor?: CacheAuditor;
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

/** Adapt the real BudgetLedger to the engine's LedgerPort (loop + org caps). */
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
    checkOrgCap(orgId) {
      return budget.checkOrgCap(orgId) as CapAction;
    },
    headroomUsd(loopId) {
      return budget.headroomUsd(loopId);
    },
    orgHeadroomUsd(orgId) {
      return budget.orgHeadroomUsd(orgId);
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
  /** Final loop health (0–100) — the last cycle's rolling gate-pass rate (engine-owned). */
  health: number;
  /** Total USD this loop spent (from the ledger) — feeds tree rollup + the org cap. */
  spentUsd: number;
}

export async function runLoopLocally(opts: RunLoopOptions): Promise<RunLoopResult> {
  const { loopId } = opts;
  const orgId = opts.orgId ?? 'org-local';
  const mission = opts.mission ?? `Run the ${loopId} department and improve every cycle.`;

  const artifacts: ArtifactPort = new GitArtifactStore({ root: opts.artifactsRoot });
  const { workspaceDir } = await artifacts.provision(loopId);
  const memory: MemoryPort = opts.memoryDir ? new FileMemoryStore(opts.memoryDir) : new InMemoryMemoryStore();
  const budget = opts.ledger ?? new BudgetLedger();
  budget.registerLoop({ orgId, loopId, hardCapUsd: opts.budgetCapUsd ?? 1000 });
  // Org-wide hard cap: enforced alongside the per-loop cap (engine takes the stricter).
  if (opts.orgBudgetCapUsd !== undefined) budget.registerOrg({ orgId, hardCapUsd: opts.orgBudgetCapUsd });

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
  // One escalation controller threaded across this run's cycles so decay persists.
  const escalation = opts.escalation ?? new EscalationController();
  // Health (rolling gate-pass rate) + cache auditor, threaded across this run's cycles.
  const health = opts.health ?? new HealthController();
  const cacheAuditor = opts.cacheAuditor ?? new CacheAuditor();
  const deps: EngineDeps = {
    runtime: opts.runtime ?? new FakeCmaRuntime(),
    artifacts,
    memory,
    rubrics: new RubricLibrary(),
    ledger: ledgerPort(budget),
    persistence,
    stepGate: opts.stepGate,
    toolGate: opts.toolGate,
    escalation,
    semaphore: opts.semaphore,
    gateConfig: opts.gateConfig,
    alerts: opts.alerts,
    health,
    cacheAuditor,
  };

  /** Emit a driver-level event on the same monotonic per-loop seq as the engine. */
  const emit = (e: Omit<DeptEvent, 'seq'>): void => {
    const stamped = { ...e, seq: persistence.nextSeq(loopId) } as DeptEvent;
    void persistence.recordEvent(stamped);
  };

  const seeds = seedsFor(loopId, mission);
  const boot = await bootstrap(loopId, artifacts, seeds);

  const detector = new NoProgressDetector(opts.noProgress);
  const cadence = opts.cadenceController ?? new CadenceController();
  const now = opts.now ?? Date.now;
  const results: CycleResult[] = [];
  const cycles = Math.max(1, opts.cycles ?? 1);
  let cycle = boot.cycle;
  let noProgressPaused = false;
  let driverSeq = 0;

  for (let i = 0; i < cycles; i += 1) {
    // Cadence floor: a continuous/hourly/… loop must wait the tier's minimum between
    // ticks. We always record the tick; we only WAIT when a sleep is injected (so the
    // CLI/tests stay fast unless cadence enforcement is explicitly requested).
    if (opts.cadence) {
      const delay = cadence.delayUntilAllowed(loopId, opts.cadence, now());
      if (delay > 0 && opts.sleep) {
        emit({
          id: `${loopId}-cadence-${driverSeq++}`,
          loopId,
          ts: new Date().toISOString(),
          kind: 'log',
          payload: { level: 'info', source: 'guardrail', message: `cadence floor (${opts.cadence}): waiting ${delay}ms before the next tick.` },
        });
        await opts.sleep(delay);
      }
      cadence.recordTick(loopId, now());
    }
    metricMovedThisCycle = false;
    const result = await runCycle(
      {
        loopId,
        orgId,
        mission,
        cycle,
        maxIterations: opts.maxIterations ?? 2,
        roles: opts.roles ?? DEFAULT_ROLES,
        fableApproved: opts.fableApproved,
      },
      deps,
    );
    results.push(result);
    // Budget cap PRECEDENCE: a hard-cap pause halts before any no-progress logic.
    if (result.paused) break;

    // The canonical Loop.health metric (rolling gate-pass rate) is now emitted by the
    // engine at the cycle boundary. The driver keeps the no-progress detector as the
    // INDEPENDENT auto-pause guard: H consecutive cycles with no meaningful diff and no
    // metric movement halt the loop even if the gates nominally pass.
    const meaningful = result.snapshots.some((s) => s.meaningful);
    const outcome = detector.record({ meaningful, metricMoved: metricMovedThisCycle });
    const ts = new Date().toISOString();
    const runId = result.runId;
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
          message: `no-progress detector: ${outcome.consecutiveStalls} cycle(s) with no meaningful diff or metric movement — auto-pausing (health ${result.health}%).`,
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
      opts.alerts?.(
        makeAlert('no_progress_pause', 'warning', `${loopId} auto-paused after ${outcome.consecutiveStalls} stalled cycle(s).`, {
          orgId,
          loopId,
          detail: { consecutiveStalls: outcome.consecutiveStalls, health: result.health },
        }),
      );
      break;
    }
    cycle += 1;
  }
  // Loop health = the last completed cycle's rolling gate-pass health (engine-owned),
  // falling back to the no-progress detector when no cycle completed.
  const lastHealth = results.length > 0 ? results[results.length - 1]!.health : detector.health;
  return {
    results,
    workspaceDir,
    noProgressPaused,
    health: lastHealth,
    spentUsd: budget.status(loopId).spentUsd,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// runTreeLocally — the LOCAL CeoWorkflow equivalent (hierarchy + meta-loop).
// ─────────────────────────────────────────────────────────────────────────────

/** One loop in a tree to run locally. The root (parentLoopId null) is the CEO. */
export interface TreeNodeSpec {
  loopId: string;
  parentLoopId: string | null;
  level: LoopLevel;
  displayName?: string;
  mission?: string;
  budgetCapUsd?: number;
  cadence?: string;
}

export interface RunTreeOptions {
  orgId?: string;
  loops: TreeNodeSpec[];
  /** Cycles each non-root (child) loop runs this invocation. Default 1. */
  cyclesPerChild?: number;
  /** Org-wide HARD cap across the WHOLE tree (the combined-spend guard). */
  orgBudgetCapUsd?: number;
  /** Max concurrent sessions per org (semaphore). Default 4. */
  maxConcurrent?: number;
  /** USD the CEO reallocates weakest→strongest in its review. Default 0 (no change). */
  reallocateUsd?: number;
  artifactsRoot?: string;
  memoryDir?: string;
  onEvent?: (e: DeptEvent) => void;
  runtime?: LoopAgentRuntime;
}

export interface RunTreeResult {
  /** Per-loop run result keyed by loopId (children only — the CEO coordinates, doesn't run a cycle). */
  perLoop: Record<string, RunLoopResult>;
  /** The tree rollup (rolled-up health/spend/status), rooted at the CEO. */
  rollup: RollupNode[];
  /** The CEO's review of its direct reports (objectives applied), or null if no children. */
  ceoReview: CeoReviewResult | null;
  /** Total USD spent across the whole tree (org rollup). */
  orgSpentUsd: number;
}

function synthLoop(spec: TreeNodeSpec, orgId: string, health: number, status: LoopStatus, spentUsd: number): Loop {
  const now = '2026-06-17T00:00:00Z';
  return {
    id: spec.loopId,
    orgId,
    parentLoopId: spec.parentLoopId,
    name: spec.loopId,
    displayName: spec.displayName ?? spec.loopId,
    level: spec.level,
    mission: spec.mission ?? `Run ${spec.loopId}.`,
    status,
    health,
    phase: null,
    cycleCount: 0,
    cadence: spec.cadence ?? 'manual',
    cmaAgentId: null,
    memoryStoreId: null,
    repoUrl: null,
    budgetCapUsd: spec.budgetCapUsd ?? 1000,
    spentUsd,
    createdAt: now,
    updatedAt: now,
  };
}

function buildForest(loops: Loop[]): LoopTreeNode[] {
  const byParent = new Map<string | null, Loop[]>();
  for (const l of loops) {
    const arr = byParent.get(l.parentLoopId) ?? [];
    arr.push(l);
    byParent.set(l.parentLoopId, arr);
  }
  const build = (l: Loop): LoopTreeNode => ({ loop: l, children: (byParent.get(l.id) ?? []).map(build) });
  return (byParent.get(null) ?? []).map(build);
}

/**
 * Run a tree of loops in-process: every non-root loop runs concurrently on ONE shared
 * ledger (so the org-wide cap sees combined spend) through ONE concurrency semaphore (so
 * the org's parallel sessions stay bounded); then the CEO (root) reviews its direct
 * reports via the Batch path and writes objectives back; finally the tree health/spend is
 * rolled up and each parent's rolled health is emitted as a `metric`. This is the local
 * equivalent of the durable Temporal `CeoWorkflow` (apps/orchestrator).
 */
export async function runTreeLocally(opts: RunTreeOptions): Promise<RunTreeResult> {
  const orgId = opts.orgId ?? 'org-local';
  const ledger = new BudgetLedger();
  if (opts.orgBudgetCapUsd !== undefined) ledger.registerOrg({ orgId, hardCapUsd: opts.orgBudgetCapUsd });
  const semaphore = new InMemorySemaphore({ maxPerOrg: opts.maxConcurrent ?? 4 });

  // Track the highest seq seen per loop so tree-level emits (CEO summary, objectives,
  // rolled health) continue AFTER each child's own run stream — no seq collision.
  const maxSeq = new Map<string, number>();
  const sink = (e: DeptEvent): void => {
    maxSeq.set(e.loopId, Math.max(maxSeq.get(e.loopId) ?? -1, e.seq));
    opts.onEvent?.(e);
  };
  const stampEmit = (e: Omit<DeptEvent, 'seq'>): void => {
    const n = (maxSeq.get(e.loopId) ?? -1) + 1;
    sink({ ...e, seq: n } as DeptEvent);
  };

  const root = opts.loops.find((l) => l.parentLoopId === null);
  const children = opts.loops.filter((l) => l.parentLoopId !== null);

  // Run every child loop concurrently — the semaphore bounds simultaneous sessions.
  const perLoop: Record<string, RunLoopResult> = {};
  await Promise.all(
    children.map(async (spec) => {
      perLoop[spec.loopId] = await runLoopLocally({
        loopId: spec.loopId,
        orgId,
        mission: spec.mission,
        cycles: opts.cyclesPerChild ?? 1,
        budgetCapUsd: spec.budgetCapUsd,
        orgBudgetCapUsd: opts.orgBudgetCapUsd,
        ledger,
        semaphore,
        cadence: spec.cadence,
        artifactsRoot: opts.artifactsRoot,
        memoryDir: opts.memoryDir,
        runtime: opts.runtime,
        onEvent: sink,
      });
    }),
  );

  const statusOf = (r: RunLoopResult): LoopStatus =>
    r.results.some((c) => c.paused) || r.noProgressPaused ? 'paused' : 'idle';

  // CEO reviews its DIRECT reports (Batch path → objectives written back).
  let ceoReview: CeoReviewResult | null = null;
  if (root) {
    const artifacts: ArtifactPort = new GitArtifactStore({ root: opts.artifactsRoot });
    const memory: MemoryPort = opts.memoryDir ? new FileMemoryStore(opts.memoryDir) : new InMemoryMemoryStore();
    const directReports = children.filter((c) => c.parentLoopId === root.loopId);
    if (directReports.length > 0) {
      const childStates: ChildState[] = await Promise.all(
        directReports.map(async (spec): Promise<ChildState> => {
          const r = perLoop[spec.loopId]!;
          return {
            loopId: spec.loopId,
            orgId,
            name: spec.displayName ?? spec.loopId,
            mission: spec.mission ?? '',
            level: spec.level,
            health: r.health,
            status: statusOf(r),
            spentUsd: r.spentUsd,
            budgetCapUsd: spec.budgetCapUsd ?? 1000,
            lastReport: (await artifacts.read(spec.loopId, 'REPORT.md'))?.slice(0, 280) ?? null,
          };
        }),
      );
      ceoReview = await runCeoReview(
        root.loopId,
        childStates,
        { artifacts, memory, ledger, emit: stampEmit },
        { reallocateUsd: opts.reallocateUsd },
      );
    }
  }

  // Roll up health/spend/status across the tree and emit each parent's rolled health.
  const loopModels = opts.loops.map((spec) => {
    const r = perLoop[spec.loopId];
    return synthLoop(
      spec,
      orgId,
      r?.health ?? 100,
      r ? statusOf(r) : 'running',
      r?.spentUsd ?? 0,
    );
  });
  const forest = buildForest(loopModels);
  const rolled = forest.map((n) => rollup(n));
  for (const node of [...rolled, ...rolled.flatMap((n) => n.children)]) {
    if (node.children.length === 0) continue; // leaves have no rollup distinct from own
    stampEmit({
      id: `${node.loopId}-rolled-health`,
      loopId: node.loopId,
      ts: '2026-06-17T00:00:00Z',
      kind: 'metric',
      payload: {
        key: 'health',
        name: 'Rolled Health',
        value: node.rolledHealth,
        display: `${node.rolledHealth}%`,
        delta: node.rolledHealth - node.ownHealth,
        goodDirection: 'up',
        unit: 'percent',
      },
    });
  }

  return { perLoop, rollup: rolled, ceoReview, orgSpentUsd: ledger.orgStatus(orgId).spentUsd };
}
