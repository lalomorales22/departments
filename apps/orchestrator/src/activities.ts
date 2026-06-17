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
  runCycle,
  type ArtifactPort,
  type ArtifactSnapshot,
  type CapAction,
  type CycleResult,
  type EngineDeps,
  type LedgerPort,
  type LoopSpec,
  type MemoryHit,
  type MemoryPort,
  type PersistencePort,
  type RoleModel,
  type RubricPort,
  type RunRecord,
} from '@departments/orchestration';
import { FakeCmaRuntime, type LoopAgentRuntime, type ModelId } from '@departments/agent-runtime';
import { RubricLibrary } from '@departments/rubrics';
import { BudgetLedger, type ModelUsage } from '@departments/cost';
import type { DeptEvent } from '@departments/events';
import type { Phase, RubricCategory, TokenUsage } from '@departments/shared';
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

/** The activity registry handed to the Temporal Worker. */
export const activities = { runCycleActivity };
