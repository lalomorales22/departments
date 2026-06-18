/**
 * Temporal activities for the LoopWorkflow.
 *
 * Activities run OUTSIDE the workflow sandbox, so they may do real I/O (git, the model
 * runtime, the ledger, the clock). The single activity here, `runCycleActivity`, is the
 * one composition root that assembles the engine's ports + a runtime and runs exactly
 * ONE cycle of the already-tested `@departments/orchestration` engine.
 *
 * ── Idempotency on runId (replay safety) ────────────────────────────────────
 * The engine derives a stable `runId = run-<loopId>-c<cycle>` per cycle. Temporal may
 * re-dispatch an activity (retry, worker restart, lost ACK). Idempotency is enforced at
 * TWO levels so a replayed tick never double-runs a cycle (double git commits, double
 * spend):
 *   1. DURABLE: the completed cycle's compact result is persisted to
 *      `<workspace>/.runs/<runId>.json`. On entry, if that record exists, the activity
 *      REATTACHES to it and returns immediately — this survives worker restarts and the
 *      lost-ACK case (the record is on the durable artifact volume, not in RAM).
 *   2. IN-PROCESS: an in-flight Promise keyed by `runId` coalesces concurrent retries
 *      that hit the same live worker before the durable record exists.
 */
import { Context } from '@temporalio/activity';
import {
  Connection,
  WorkflowClient,
  WorkflowIdReusePolicy,
  WorkflowExecutionAlreadyStartedError,
} from '@temporalio/client';
import {
  runCeoReview,
  runCycle,
  SpawnController,
  autoApproveSpawnGate,
  type ArtifactPort,
  type ArtifactSnapshot,
  type CapAction,
  type ChildState,
  type CeoReviewDeps,
  type CycleResult,
  type EngineDeps,
  type LedgerPort,
  type LoopSpec,
  type MemoryHit,
  type MemoryPort,
  type Objective,
  type ObjectiveLedger,
  type PersistencePort,
  type RoleModel,
  type RubricPort,
  type RunRecord,
  type SpawnRequest,
} from '@departments/orchestration';
import { FakeCmaRuntime, type LoopAgentRuntime, type ModelId } from '@departments/agent-runtime';
import { RubricLibrary } from '@departments/rubrics';
import { BudgetLedger, type ModelUsage } from '@departments/cost';
import type { DeptEvent } from '@departments/events';
import type { LoopLevel, Phase, RubricCategory, TokenUsage } from '@departments/shared';
import type { LoopWorkflowInput } from './workflows.js';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ─── I/O contracts between workflow and activity (must be JSON-serializable) ────

/** Compact, JSON-serializable state carried per cycle and across continue-as-new. */
export interface CompactCycleState {
  /** Running ledger snapshot — survives the history reset so caps stay enforced. */
  ledger: { spentUsd: number };
  /** Pointer to the last HANDOFF entry the next PLAN should read. */
  lastHandoffPointer: string | null;
}

export interface RunCycleInput {
  loopId: string;
  orgId?: string;
  mission: string;
  /** 1-based cycle number to run. Drives the engine's stable `runId`. */
  cycle: number;
  /** Carried compact state from the prior cycle (or the continue-as-new boundary). */
  carried: { ledger: { spentUsd: number }; lastHandoffPointer: string | null };
}

/** Compact result returned to the workflow — never the full event/snapshot history. */
export interface RunCycleOutput {
  loopId: string;
  cycle: number;
  runId: string;
  reworks: number;
  paused: boolean;
  downgraded: boolean;
  costUsd: number;
  cacheReadTokens: number;
  meaningfulChange: boolean;
  finalResult: string | null;
  state: CompactCycleState;
}

// ─── Per-loop budget cap config (env-tunable; defaults keep dev loops alive) ────

function hardCapUsd(): number {
  const raw = process.env.LOOP_HARD_CAP_USD;
  const n = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

/** Org-wide hard cap on combined spend (Phase 4). Unset → unbounded org cap. */
function orgHardCapUsd(): number {
  const raw = process.env.ORG_HARD_CAP_USD;
  const n = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

// ─── Idempotency: in-process coalescing + a durable per-run record ──────────────

const inFlight = new Map<string, Promise<RunCycleOutput>>();

/** Load a previously-completed cycle's compact result, or null if this runId is new. */
async function readRunRecord(path: string): Promise<RunCycleOutput | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as RunCycleOutput;
  } catch {
    return null;
  }
}

/** Persist a completed cycle's compact result so a later replay reattaches instead of re-running. */
async function writeRunRecord(path: string, output: RunCycleOutput): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(output), 'utf8');
}

// ─── Runtime selection: Fake by default, CmaRuntime when configured ─────────────

/**
 * The default runtime is `FakeCmaRuntime` — deterministic, network-free, and the same
 * one the engine's own tests use, so a worker runs a genuine cycle (real artifact
 * diffs, an independent grader, prompt-cache warmth on cycle > 1) with no creds.
 *
 * Real CMA wiring is gated behind `ANTHROPIC_API_KEY` (+ `USE_CMA_RUNTIME=1`). The
 * `agent-runtime` package owns the real `CmaRuntime` (Phase 2 AI task); when it lands
 * and exports it, swap the import here. Until then we fail loud rather than silently
 * pretend to be real.
 */
function selectRuntime(): LoopAgentRuntime {
  const wantsCma = process.env.USE_CMA_RUNTIME === '1' || process.env.USE_CMA_RUNTIME === 'true';
  if (wantsCma) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'USE_CMA_RUNTIME is set but ANTHROPIC_API_KEY is missing — refusing to run the real runtime without creds.',
      );
    }
    // The real CmaRuntime is provided by @departments/agent-runtime once its `cma`
    // adapter lands (Phase 2 AI task). It implements the SAME LoopAgentRuntime contract,
    // so only this construction line changes — the engine + ports are untouched.
    throw new Error(
      'CmaRuntime requested but not yet wired — unset USE_CMA_RUNTIME to run the FakeCmaRuntime, or wire @departments/agent-runtime/cma here.',
    );
  }
  return new FakeCmaRuntime();
}

// ─── Engine deps (the hexagonal ports), assembled per cycle ─────────────────────

/**
 * Adapt `@departments/cost`'s BudgetLedger to the engine's `LedgerPort` shape.
 *
 * BudgetLedger owns the authoritative price-table cost math (`recordUsage` → USD). We
 * enforce the HARD cap on CUMULATIVE spend across cycles by seeding from the carried
 * ledger snapshot (`seedSpentUsd`) — so a continue-as-new generation keeps the cap, and
 * a hard breach makes `checkCap` return `'pause'` (the engine then pauses, precedence
 * over escalation). Soft cap (80%) → `'downgrade'`.
 */
function makeLedgerPort(seedSpentUsd: number): LedgerPort & { spentUsd(): number } {
  const ledger = new BudgetLedger();
  const hard = hardCapUsd();
  const orgHard = orgHardCapUsd();
  let registered = false;
  let spent = seedSpentUsd;
  return {
    spentUsd: () => spent,
    recordUsage(scope, usage: TokenUsage, modelId): { costUsd: number } {
      if (!registered) {
        ledger.registerLoop({ orgId: scope.orgId ?? 'org-local', loopId: scope.loopId, hardCapUsd: hard });
        registered = true;
      }
      const usageForCost: ModelUsage = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
      };
      const costUsd = ledger.recordUsage(
        { orgId: scope.orgId ?? 'org-local', loopId: scope.loopId, runId: scope.runId },
        usageForCost,
        modelId,
      );
      spent += costUsd;
      return { costUsd };
    },
    checkCap(_loopId: string): CapAction {
      if (!Number.isFinite(hard)) return 'ok';
      if (spent >= hard) return 'pause';
      if (spent >= hard * 0.8) return 'downgrade';
      return 'ok';
    },
    // Org-wide rollup cap. In this single-loop activity the ONLY spend the worker sees is
    // this loop's cumulative `spent` (org-combined spend is folded by the CEO/tree path,
    // not by one loop's worker), so we evaluate the org cap against the same `spent`. The
    // engine takes the STRICTER of checkCap/checkOrgCap, so this never RELAXES a loop cap.
    checkOrgCap(_orgId: string): CapAction {
      if (!Number.isFinite(orgHard)) return 'ok';
      if (spent >= orgHard) return 'pause';
      if (spent >= orgHard * 0.8) return 'downgrade';
      return 'ok';
    },
    headroomUsd(_loopId: string): number {
      return Number.isFinite(hard) ? Math.max(0, hard - spent) : Number.POSITIVE_INFINITY;
    },
    orgHeadroomUsd(_orgId: string): number {
      return Number.isFinite(orgHard) ? Math.max(0, orgHard - spent) : Number.POSITIVE_INFINITY;
    },
  };
}

/** In-memory cross-cycle memory recall. Swap for @departments/memory's pgvector index
 *  at the composition root once that package exports a MemoryPort adapter. */
function makeMemoryPort(): MemoryPort {
  const store: Array<{ path: string; summary: string }> = [];
  return {
    async query(_loopId: string, _q: string, k: number): Promise<MemoryHit[]> {
      return store.slice(-k).map((e, i) => ({ path: e.path, summary: e.summary, relevance: 0.9 - i * 0.1 }));
    },
    async append(_loopId: string, entry: { path: string; summary: string }): Promise<void> {
      store.push(entry);
    },
  };
}

/** The four gates as gradeable criteria, from @departments/rubrics. */
function makeRubricPort(): RubricPort {
  const lib = new RubricLibrary();
  return {
    criteria(loopId: string): Record<RubricCategory, string> {
      return lib.criteria(loopId);
    },
  };
}

/** Audit/feed sink. Emits the per-loop monotonic `seq` allocator the engine stamps
 *  and forwards events to the activity heartbeat/log. Phase 3 swaps `recordEvent` for
 *  the Redis-Streams → WS spine; `recordRun` for the Postgres `Run` audit spine. */
function makePersistencePort(): PersistencePort {
  const seqs = new Map<string, number>();
  return {
    nextSeq(loopId: string): number {
      const n = seqs.get(loopId) ?? 0;
      seqs.set(loopId, n + 1);
      return n;
    },
    recordEvent(e: DeptEvent): void {
      // Heartbeat so Temporal sees progress on a long cycle and can resume if the worker
      // dies. Details are the resume cursor `(loopId, seq)`.
      try {
        Context.current().heartbeat({ loopId: e.loopId, seq: e.seq, kind: e.kind });
      } catch {
        // No activity context (e.g. a unit test calling the port directly) — ignore.
      }
    },
    recordRun(_r: RunRecord): void {
      // Phase 3: persist one Run per (loop, phase, tick) to Postgres (the audit spine).
    },
  };
}

// ─── Git-backed artifact store (real diffs) with an in-memory fallback ──────────

/**
 * GitArtifactStore — the engine's `ArtifactPort` backed by a real per-loop git working
 * tree under `ARTIFACTS_ROOT` (default the OS temp dir). It seeds README/TASKS/HANDOFF
 * on cold start, snapshots changed files as tagged commits (`loopId:runId:phase`), and
 * flags a snapshot `meaningful` only when something OTHER than HANDOFF.md changed — the
 * no-progress detector's anti-churn rule.
 *
 * If `git` is unavailable, it degrades to a pure-filesystem diff (still real files, no
 * commits) so a dev box without git configured still completes a cycle.
 */
function makeGitArtifactStore(): ArtifactPort {
  const root = process.env.ARTIFACTS_ROOT ?? join(tmpdir(), 'departments-artifacts');
  let workspaceDir = '';
  let gitOk = false;
  let version = 0;
  let last = new Map<string, string>();

  async function git(args: string[]): Promise<void> {
    await execFileAsync('git', ['-C', workspaceDir, ...args]);
  }

  async function scan(dir: string, baseRel = ''): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const ent of entries) {
      if (ent.name === '.git') continue;
      const rel = baseRel ? `${baseRel}/${ent.name}` : ent.name;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        for (const [k, v] of await scan(abs, rel)) out.set(k, v);
      } else {
        out.set(rel, await readFile(abs, 'utf8'));
      }
    }
    return out;
  }

  return {
    async provision(loopId: string): Promise<{ workspaceDir: string }> {
      if (!workspaceDir) {
        workspaceDir = join(root, loopId);
        await mkdir(workspaceDir, { recursive: true });
        try {
          await git(['rev-parse', '--is-inside-work-tree']);
          gitOk = true;
        } catch {
          try {
            await git(['init', '--quiet']);
            await git(['config', 'user.email', 'loop@departments.local']);
            await git(['config', 'user.name', 'Departments Loop']);
            gitOk = true;
          } catch {
            gitOk = false; // git missing — fall back to filesystem diffs.
          }
        }
        last = await scan(workspaceDir);
      }
      return { workspaceDir };
    },
    async seedIfEmpty(_loopId: string, seeds: Record<string, string>): Promise<void> {
      for (const [rel, content] of Object.entries(seeds)) {
        const abs = join(workspaceDir, rel);
        try {
          await readFile(abs, 'utf8');
        } catch {
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, content, 'utf8');
        }
      }
      last = await scan(workspaceDir);
    },
    async read(_loopId: string, rel: string): Promise<string | null> {
      try {
        return await readFile(join(workspaceDir, rel), 'utf8');
      } catch {
        return null;
      }
    },
    async write(_loopId: string, rel: string, content: string): Promise<void> {
      // Overwrite an artifact's text (the CEO's set_objective writes a child's STRATEGY.md).
      // The next `snapshot` will pick it up as a changed file; keep `last` in sync so a
      // write followed immediately by a snapshot reports the right diff.
      const abs = join(workspaceDir, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
    },
    async snapshot(_loopId: string, meta: { runId: string; phase: Phase; message: string }): Promise<ArtifactSnapshot> {
      const cur = await scan(workspaceDir);
      const changedFiles: string[] = [];
      for (const [k, v] of cur) if (last.get(k) !== v) changedFiles.push(k);
      last = cur;
      version += 1;
      // Anti-churn rule: HANDOFF.md is rewritten EVERY cycle, so it never counts as
      // meaningful progress on its own (see README no-progress guardrail).
      const meaningful = changedFiles.some((f) => f !== 'HANDOFF.md');
      let sha = `fs-${version}`;
      if (gitOk && changedFiles.length > 0) {
        try {
          await git(['add', '-A']);
          await git(['commit', '--quiet', '--allow-empty', '-m', meta.message]);
          const { stdout } = await execFileAsync('git', ['-C', workspaceDir, 'rev-parse', 'HEAD']);
          sha = stdout.trim();
          // Tag the commit `loopId:runId:phase` (git refs forbid ':', so substitute).
          const tag = meta.message.replace(/[^A-Za-z0-9_.-]/g, '_');
          await git(['tag', '--force', tag]).catch(() => undefined);
        } catch {
          sha = `fs-${version}`;
        }
      }
      return { sha, version: `v${version}`, changedFiles, meaningful };
    },
  };
}

// ─── Role → model tiering (the corrected knobs from the model-facts table) ──────

const OPUS: ModelId = 'claude-opus-4-8';
const SONNET: ModelId = 'claude-sonnet-4-6';

/** Default per-role model assignment (README "AI layer & model tiering"):
 *  Planner/Reviewer/Docs judgment → Opus 4.8 `high`; Executor → Sonnet 4.6 `medium`. */
function roleModels(): LoopSpec['roles'] {
  const judgment: RoleModel = { modelId: OPUS, effort: 'high' };
  const executor: RoleModel = { modelId: SONNET, effort: 'medium' };
  return {
    planner: judgment,
    executor,
    reviewer: judgment,
    docs: judgment,
  };
}

const COLD_START_SEEDS: Record<string, string> = {
  'README.md': '# Loop\n\nAutonomous department. Mission set at bootstrap.\n',
  'TASKS.md': '# TASKS\n\n- [ ] Bootstrap: establish the first cycle plan.\n',
  'HANDOFF.md': '# HANDOFF\n\n- Cycle: 0\n- Status: cold start.\n',
};

// ─── The activity ───────────────────────────────────────────────────────────────

/**
 * Run ONE engine cycle. Idempotent on the engine's stable `runId` (run-<loopId>-c<cycle>):
 * a second attempt with the same runId reattaches to the in-flight result.
 */
export async function runCycleActivity(input: RunCycleInput): Promise<RunCycleOutput> {
  const runId = `run-${input.loopId}-c${input.cycle}`;
  const existing = inFlight.get(runId);
  if (existing) return existing;

  const promise = (async (): Promise<RunCycleOutput> => {
    const artifacts = makeGitArtifactStore();
    const { workspaceDir } = await artifacts.provision(input.loopId);

    // DURABLE idempotency: if this exact cycle already completed (record on the artifact
    // volume), reattach to its result rather than re-running — survives worker restarts.
    const runRecordPath = join(workspaceDir, '.runs', `${runId}.json`);
    const prior = await readRunRecord(runRecordPath);
    if (prior) return prior;

    // Seed artifacts so a cold-start cycle has README/TASKS/HANDOFF to read.
    await artifacts.seedIfEmpty(input.loopId, COLD_START_SEEDS);

    const deps: EngineDeps = {
      runtime: selectRuntime(),
      artifacts,
      memory: makeMemoryPort(),
      rubrics: makeRubricPort(),
      ledger: makeLedgerPort(input.carried.ledger.spentUsd),
      persistence: makePersistencePort(),
    };

    const spec: LoopSpec = {
      loopId: input.loopId,
      orgId: input.orgId,
      mission: input.mission,
      cycle: input.cycle,
      maxIterations: 2,
      roles: roleModels(),
    };

    const result: CycleResult = await runCycle(spec, deps);

    const meaningfulChange = result.snapshots.some((s) => s.meaningful);
    // MEMORY always writes HANDOFF.md, so a completed cycle advances the handoff pointer.
    const handoffPointer =
      result.snapshots.length > 0 ? `HANDOFF.md#cycle-${input.cycle}` : input.carried.lastHandoffPointer;

    const output: RunCycleOutput = {
      loopId: result.loopId,
      cycle: result.cycle,
      runId: result.runId,
      reworks: result.reworks,
      paused: result.paused,
      downgraded: result.downgraded,
      costUsd: result.costUsd,
      cacheReadTokens: result.cacheReadTokens,
      meaningfulChange,
      finalResult: result.finalVerdict?.result ?? null,
      state: {
        ledger: { spentUsd: input.carried.ledger.spentUsd + result.costUsd },
        lastHandoffPointer: handoffPointer,
      },
    };

    // Persist the durable idempotency record ONLY for a completed (non-paused) cycle — a
    // paused cycle must be re-runnable, so we don't mark it done.
    if (!result.paused) await writeRunRecord(runRecordPath, output);
    return output;
  })();

  inFlight.set(runId, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(runId);
  }
}

// ─── Phase 4: child-loop spawning (the hierarchy activity) ──────────────────────

/** Task queue the LoopWorkflow + its activities are registered on (mirrors worker.ts). */
const TASK_QUEUE = 'departments';

/** Temporal frontend address; the dev stack exposes `127.0.0.1:7233`. */
function temporalAddress(): string {
  return process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
}

/**
 * The org-wide SpawnController, module-level so its structural bookkeeping (per-org child
 * count, the denial-loop guard, the spawned-set) persists ACROSS activity invocations on
 * this worker — the runaway guard only works if the count is shared, not per-call. (A
 * multi-worker fleet additionally relies on the DERIVED, stable child workflowId +
 * REJECT_DUPLICATE below to make a re-spawn a no-op even across processes.) Policy floors
 * come from {@link SpawnController}'s defaults (maxDepth 4, perOrgChildCap 32, maxQueued 16).
 */
const spawnController = new SpawnController();

export interface SpawnChildInput {
  orgId: string;
  /** The requesting parent loop. */
  parentLoopId: string;
  /** The parent's level; the child becomes `parentLevel + 1`. */
  parentLevel: LoopLevel;
  /** One-word child handle (`loop <name>`), unique within its parent. */
  childName: string;
  /** The child loop's id (the DERIVED workflowId is `loop-${childLoopId}`). */
  childLoopId: string;
  mission: string;
  /** Cadence tier for the child loop (default 'continuous'). */
  cadence?: string;
  /** Cycles the child runs before continue-as-new (default 8). */
  cyclesPerWorkflow?: number;
  /** Hard cycle ceiling for the child (0 = unbounded; default 0). */
  maxCycles?: number;
}

export interface SpawnChildOutput {
  spawned: boolean;
  childWorkflowId: string;
  /** The resolved child level when spawned. */
  childLevel?: LoopLevel;
  /** Reason a spawn was denied or skipped (cap/depth/denial-guard/already-running). */
  reason?: string;
}

/**
 * Spawn a child loop. Structural pre-flight + auto-approval run through the module-level
 * {@link SpawnController} (enforcing maxDepth / per-org cap / the denial-loop guard); a
 * `loop-${childLoopId}` workflowId + `REJECT_DUPLICATE` reuse policy then make a retried
 * spawn a no-op (the first start wins, a duplicate throws
 * {@link WorkflowExecutionAlreadyStartedError}, which we swallow as "already spawned").
 *
 * GATED: with no `TEMPORAL_ADDRESS` reachable the start fails loud (a connection error
 * propagates so Temporal retries) — we never silently pretend a child exists.
 */
export async function spawnChildActivity(input: SpawnChildInput): Promise<SpawnChildOutput> {
  const childWorkflowId = `loop-${input.childLoopId}`;
  const req: SpawnRequest = {
    orgId: input.orgId,
    parentLoopId: input.parentLoopId,
    childName: input.childName,
    mission: input.mission,
    parentLevel: input.parentLevel,
  };

  // Structural rules + auto-approval (the real approval gate is the cockpit's banner;
  // here, post-structural-check, we auto-approve — the SpawnController still enforces
  // depth/cap/denial-guard before the approval runs).
  const verdict = await spawnController.resolve(req, autoApproveSpawnGate);
  if (verdict.decision === 'deny') {
    return { spawned: false, childWorkflowId, reason: verdict.reason };
  }

  const connection = await Connection.connect({ address: temporalAddress() });
  try {
    const client = new WorkflowClient({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    });
    const childInput: LoopWorkflowInput = {
      loopId: input.childLoopId,
      orgId: input.orgId,
      mission: input.mission,
      maxCycles: input.maxCycles ?? 0,
      cyclesPerWorkflow: input.cyclesPerWorkflow ?? 8,
      cadence: input.cadence ?? 'continuous',
      parentLoopId: input.parentLoopId,
      level: verdict.childLevel,
    };
    try {
      await client.start('loopWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId: childWorkflowId,
        // A retried activity (or a concurrent worker) MUST NOT double-spawn the child;
        // REJECT_DUPLICATE makes the second start throw AlreadyStarted, caught below.
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        args: [childInput],
      });
      return { spawned: true, childWorkflowId, childLevel: verdict.childLevel };
    } catch (err) {
      if (err instanceof WorkflowExecutionAlreadyStartedError) {
        // Idempotent: the child already exists (a prior attempt won the race) — treat the
        // retry as a successful no-op rather than re-spawning.
        return { spawned: false, childWorkflowId, childLevel: verdict.childLevel, reason: 'already running' };
      }
      throw err;
    }
  } finally {
    await connection.close();
  }
}

// ─── Phase 4: the CEO review activity (meta-loop async steer) ────────────────────

export interface CeoReviewInput {
  ceoLoopId: string;
  orgId?: string;
  /** The direct-report child loop ids the CEO reviews. */
  childLoopIds: string[];
  /** The CEO's mission/charter (the stable shared prefix for the batch grade). */
  mission: string;
  /** 1-based review number (drives the stable, idempotent reviewId). */
  review: number;
  /** USD to reallocate weakest→strongest (0/undefined = no budget move). */
  reallocateUsd?: number;
}

export interface CeoReviewOutput {
  ceoLoopId: string;
  review: number;
  reviewId: string;
  /** One steer per child (loopId + objective + budget delta). */
  objectives: Objective[];
  /** Total USD the batched review cost (priced at the 50% Batch rate). */
  reviewCostUsd: number;
}

/**
 * In-memory ObjectiveLedger: set_objective only needs `registerLoop` to record a cap
 * adjustment. The authoritative per-loop cap lives in each child loop's own ledger;
 * here we accept the call so the budget delta is applied without crashing.
 */
function makeObjectiveLedger(): ObjectiveLedger {
  return {
    registerLoop(_config: { orgId: string; loopId: string; hardCapUsd: number }): void {
      // No-op sink in this composition root; the child loop's worker owns the real cap.
    },
  };
}

/**
 * Run ONE CEO review over the direct reports. Idempotent on the stable `reviewId`
 * (`ceo-review-<ceoLoopId>-r<review>`): a re-dispatched attempt reattaches to the durable
 * record on the artifact volume rather than re-grading + re-writing objectives.
 *
 * Reuses the SAME port helpers as `runCycleActivity` (git artifacts / memory / a no-op
 * persistence emit) so the CEO writes each child's STRATEGY.md into that child's working
 * tree and seeds its memory — exactly the engine's local-driver wiring.
 */
export async function ceoReviewActivity(input: CeoReviewInput): Promise<CeoReviewOutput> {
  const reviewId = `ceo-review-${input.ceoLoopId}-r${input.review}`;
  const existing = inFlightReview.get(reviewId);
  if (existing) return existing;

  const promise = (async (): Promise<CeoReviewOutput> => {
    const orgId = input.orgId ?? 'org-local';
    const artifacts = makeGitArtifactStore();
    // Provision the CEO's own tree so the review-record path resolves on the durable volume.
    const { workspaceDir } = await artifacts.provision(input.ceoLoopId);

    const reviewRecordPath = join(workspaceDir, '.reviews', `${reviewId}.json`);
    const prior = await readReviewRecord(reviewRecordPath);
    if (prior) return prior;

    const memory = makeMemoryPort();
    const persistence = makePersistencePort();

    // Read each child's last REPORT for the grade. Children that have never run (no tree
    // provisioned yet) simply contribute a null report — the grader handles that.
    const children: ChildState[] = await Promise.all(
      input.childLoopIds.map(async (loopId): Promise<ChildState> => {
        await artifacts.provision(loopId);
        const lastReport = (await artifacts.read(loopId, 'REPORT.md'))?.slice(0, 280) ?? null;
        return {
          loopId,
          orgId,
          name: loopId,
          mission: input.mission,
          // Children sit one level below the CEO; the CEO is the root (L1), reports L2.
          level: 2,
          health: 100,
          status: 'idle',
          spentUsd: 0,
          budgetCapUsd: 1000,
          lastReport,
        };
      }),
    );

    const deps: CeoReviewDeps = {
      artifacts,
      memory,
      ledger: makeObjectiveLedger(),
      // Forward CEO/objective events to the existing persistence seam (heartbeat/audit).
      // The driver stamps `seq` (the engine's allocator), so we stamp it here too.
      emit: (e): void => {
        const stamped = { ...e, seq: persistence.nextSeq(e.loopId) } as DeptEvent;
        void persistence.recordEvent(stamped);
      },
      // `batch` defaults to FakeBatchReviewRuntime inside runCeoReview (network-free); the
      // real CmaBatchReviewRuntime swaps in once @departments/agent-runtime is creds-wired.
    };

    const result = await runCeoReview(input.ceoLoopId, children, deps, {
      reallocateUsd: input.reallocateUsd,
      reviewId,
    });

    const output: CeoReviewOutput = {
      ceoLoopId: input.ceoLoopId,
      review: input.review,
      reviewId: result.reviewId,
      objectives: result.objectives,
      reviewCostUsd: result.reviewCostUsd,
    };
    await writeReviewRecord(reviewRecordPath, output);
    return output;
  })();

  inFlightReview.set(reviewId, promise);
  try {
    return await promise;
  } finally {
    inFlightReview.delete(reviewId);
  }
}

/** In-process coalescing for concurrent CEO-review retries (mirrors `inFlight`). */
const inFlightReview = new Map<string, Promise<CeoReviewOutput>>();

async function readReviewRecord(path: string): Promise<CeoReviewOutput | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as CeoReviewOutput;
  } catch {
    return null;
  }
}

async function writeReviewRecord(path: string, output: CeoReviewOutput): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(output), 'utf8');
}

/** The activity registry handed to the Temporal Worker. */
export const activities = { runCycleActivity, spawnChildActivity, ceoReviewActivity };
