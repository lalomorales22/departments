/**
 * The durable per-loop workflow (Temporal). ONE workflow instance per Loop.
 *
 * This is the composition root that ticks the already-built, already-tested
 * `@departments/orchestration` engine: it does NO cycle logic itself. Each cycle is
 * one `runCycleActivity` call (see `./activities`); the workflow only sequences
 * cycles, reacts to control signals, and recycles its own history.
 *
 * ── Determinism ─────────────────────────────────────────────────────────────
 * Workflow code is REPLAYED by Temporal, so it must be deterministic: no
 * `Date.now()`, no `Math.random()`, no direct I/O. All non-determinism (the model
 * runtime, git, the clock, the ledger) lives behind `runCycleActivity`. Where this
 * file needs a stable identity it derives it from `workflowInfo()` + the cycle
 * counter — both replay-stable.
 *
 * ── continue-as-new ─────────────────────────────────────────────────────────
 * A loop "runs indefinitely", so its event history would grow without bound. After
 * `cyclesPerWorkflow` cycles the workflow calls `continueAsNew` with a COMPACT
 * carried state — the cycle pointer, a ledger snapshot, and the last HANDOFF pointer
 * — starting a fresh history that resumes exactly where this run left off. Files are
 * the real cross-cycle memory (HANDOFF.md in git); the carried state is only the
 * small pointer set the workflow needs to keep sequencing without re-reading history.
 *
 * ── Signals ─────────────────────────────────────────────────────────────────
 *  - `runNow`  — wakes the workflow immediately (a Condition gate) so an operator can
 *                force the next cycle without waiting; it also un-pauses.
 *  - `pause`   — sets a flag; the workflow finishes any in-flight cycle, then idles on
 *                the Condition until `runNow` (or unpause) arrives. Cost/human caps in
 *                the engine can also pause the loop; this is the operator's kill switch.
 */
import {
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import type { CompactCycleState, RunCycleInput, RunCycleOutput } from './activities';

/** Workflow input. `orgId` scopes the ledger; missions are the durable objective. */
export interface LoopWorkflowInput {
  loopId: string;
  orgId?: string;
  mission: string;
  /** Hard ceiling on total cycles across ALL continue-as-new generations. 0 = unbounded. */
  maxCycles: number;
  /** Cycles to run before recycling history via continue-as-new. */
  cyclesPerWorkflow: number;
  /**
   * Carried-across-continue-as-new compact state. Absent on the very first start;
   * populated by this workflow when it recycles itself.
   */
  carried?: CarriedState;
}

/** The COMPACT state carried across a continue-as-new boundary (never full history). */
export interface CarriedState {
  /** Next cycle number to run (1-based). The engine's resumable bootstrap also derives
   *  this from HANDOFF.md; we carry it so we don't have to read history to sequence. */
  nextCycle: number;
  /** Ledger snapshot so spend/cap state survives the history reset. */
  ledger: CompactCycleState['ledger'];
  /** Pointer to the last written HANDOFF (e.g. "HANDOFF.md#cycle-7"); the next PLAN reads it. */
  lastHandoffPointer: string | null;
  /** True if the loop was paused (by an operator or a hard cap) when it recycled. */
  paused: boolean;
}

/** `runNow` — force the next cycle immediately (and clear a pause). No payload. */
export const runNowSignal = defineSignal('runNow');
/** `pause` — set the pause flag; the loop idles after the current cycle. No payload. */
export const pauseSignal = defineSignal('pause');

/** Lightweight introspection for the gateway/UI (does not affect determinism). */
export interface LoopWorkflowStatus {
  loopId: string;
  cycle: number;
  paused: boolean;
  lastHandoffPointer: string | null;
  spentUsd: number;
}
export const statusQuery = defineQuery<LoopWorkflowStatus>('status');

/** Activities are I/O — proxied with timeouts + retries; the engine owns the work. */
const { runCycleActivity } = proxyActivities<{
  runCycleActivity(input: RunCycleInput): Promise<RunCycleOutput>;
}>({
  // One cycle is several model turns + git snapshots; give it room.
  startToCloseTimeout: '30 minutes',
  // Idempotent on runId (the activity reattaches by runId), so retries are safe.
  retry: {
    initialInterval: '5s',
    backoffCoefficient: 2,
    maximumInterval: '2m',
    maximumAttempts: 5,
  },
});

const ZERO_LEDGER: CompactCycleState['ledger'] = { spentUsd: 0 };

/**
 * The durable LoopWorkflow.
 *
 * Loops `cyclesPerWorkflow` times (each cycle = one activity), honoring `pause` /
 * `runNow`, then continue-as-news with a compact carried state. Stops only when
 * `maxCycles` is reached (if set) or the loop is paused at a recycle boundary by a
 * hard cap with nowhere further to go.
 */
export async function loopWorkflow(input: LoopWorkflowInput): Promise<void> {
  const carried: CarriedState = input.carried ?? {
    nextCycle: 1,
    ledger: ZERO_LEDGER,
    lastHandoffPointer: null,
    paused: false,
  };

  // ── Control state (mutated only by signal handlers; replay-stable) ──────────
  let runNowRequested = false;
  let paused = carried.paused;
  let cycle = carried.nextCycle;
  let ledger = carried.ledger;
  let lastHandoffPointer = carried.lastHandoffPointer;

  setHandler(runNowSignal, () => {
    // `runNow` both wakes the Condition and clears a pause (operator override).
    runNowRequested = true;
    paused = false;
  });
  setHandler(pauseSignal, () => {
    paused = true;
  });
  setHandler(statusQuery, (): LoopWorkflowStatus => ({
    loopId: input.loopId,
    cycle,
    paused,
    lastHandoffPointer,
    spentUsd: ledger.spentUsd,
  }));

  log.info('loopWorkflow started', {
    loopId: input.loopId,
    startCycle: cycle,
    cyclesPerWorkflow: input.cyclesPerWorkflow,
    maxCycles: input.maxCycles,
    runId: workflowInfo().runId,
  });

  const cyclesThisRun = Math.max(1, input.cyclesPerWorkflow);
  let ranInThisGeneration = 0;

  while (ranInThisGeneration < cyclesThisRun) {
    if (input.maxCycles > 0 && cycle > input.maxCycles) {
      log.info('maxCycles reached — loop complete', { loopId: input.loopId, cycle, maxCycles: input.maxCycles });
      return;
    }

    // If paused, idle on the Condition until `runNow` (which also un-pauses) arrives.
    if (paused) {
      log.info('loop paused — awaiting runNow', { loopId: input.loopId, cycle });
      await condition(() => runNowRequested);
      runNowRequested = false;
      // `runNow` cleared `paused` in its handler; loop back around to the guard.
      continue;
    }

    log.info('running cycle', { loopId: input.loopId, cycle });
    const out = await runCycleActivity({
      loopId: input.loopId,
      orgId: input.orgId,
      mission: input.mission,
      cycle,
      carried: { ledger, lastHandoffPointer },
    });

    // Fold the activity's compact result into carried state for the next tick / recycle.
    ledger = out.state.ledger;
    lastHandoffPointer = out.state.lastHandoffPointer ?? lastHandoffPointer;
    cycle += 1;
    ranInThisGeneration += 1;

    if (out.paused) {
      // The engine paused the loop (hard budget cap / human gate precedence). Mirror it
      // into our own flag so we idle here instead of burning more cycles.
      paused = true;
      log.warn('engine paused the loop (cap/gate) — idling', { loopId: input.loopId, cycle });
    }
  }

  // ── Recycle history: continue-as-new with COMPACT carried state ─────────────
  const nextCarried: CarriedState = {
    nextCycle: cycle,
    ledger,
    lastHandoffPointer,
    paused,
  };
  log.info('continue-as-new (history recycle)', {
    loopId: input.loopId,
    nextCycle: cycle,
    paused,
    spentUsd: ledger.spentUsd,
  });
  await continueAsNew<typeof loopWorkflow>({ ...input, carried: nextCarried });
}
