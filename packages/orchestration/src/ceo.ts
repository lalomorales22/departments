/**
 * ceo.ts — the CEO META-LOOP: async steer over a tree of child loops (Phase 4).
 *
 * The CEO does NOT produce work; it COORDINATES. Each review it:
 *   1. reads every child's last PERSISTED state (REPORT/health/spend) — never blocking on
 *      a child that happens to be mid-cycle (async steer);
 *   2. grades the children's summaries through the BATCH API (50% off, shared cached
 *      prefix) — `@departments/agent-runtime` submits, the ledger prices it at half;
 *   3. plans an objective per child ({@link planObjectives}, pure) and reallocates budget
 *      between units;
 *   4. applies each via {@link setObjective} — writing the child's CEO-owned STRATEGY.md,
 *      seeding its memory (so the child's next PLAN reads it), adjusting its budget cap,
 *      and emitting an `objective` event surfaced in the child's HISTORY.
 *
 * `planObjectives` is pure + tested; `setObjective`/`runCeoReview` are driver effects that
 * talk only through the ports + a batch runtime.
 */
import type { LoopStatus } from '@departments/shared';
import type { DeptEvent } from '@departments/events';
import {
  type BatchReviewRuntime,
  type BatchReviewVerdict,
  FakeBatchReviewRuntime,
} from '@departments/agent-runtime';
import { batchCostOfUsage } from '@departments/cost';
import type { ArtifactPort, Clock, MemoryPort } from './ports.js';
import { systemClock } from './ports.js';

/** A child unit's last persisted state, as the CEO reads it (never blocking). */
export interface ChildState {
  loopId: string;
  orgId: string;
  name: string;
  mission: string;
  level: number;
  health: number;
  status: LoopStatus;
  spentUsd: number;
  budgetCapUsd: number;
  /** Last REPORT.md excerpt + metric summary (what the CEO grades). */
  lastReport?: string | null;
}

/** A steer the CEO writes to one child. */
export interface Objective {
  loopId: string;
  objective: string;
  /** Budget cap adjustment in USD (+ grants headroom, − reclaims). */
  budgetDeltaUsd: number;
  rationale: string;
}

export interface PlanObjectivesOptions {
  /** USD to move from the weakest unit to the strongest (0 = no budget change). */
  reallocateUsd?: number;
  /** Health below which a unit is "struggling". Default 70. */
  recoverBelow?: number;
  /** Health at/above which a unit can "scale". Default 90. */
  scaleAtOrAbove?: number;
}

function objectiveText(c: ChildState, recoverBelow: number, scaleAtOrAbove: number): { objective: string; rationale: string } {
  if (c.status === 'paused' || c.status === 'error') {
    return { objective: 'Stabilize: resolve the blocking issue and resume the cycle.', rationale: `${c.name} is ${c.status}.` };
  }
  if (c.health < recoverBelow) {
    return { objective: 'Recover: concentrate the next cycles on the failing gate; keep diffs scoped.', rationale: `health ${c.health}% < ${recoverBelow}%.` };
  }
  if (c.health >= scaleAtOrAbove) {
    return { objective: 'Scale: increase output cadence; you have headroom and a clean grader record.', rationale: `health ${c.health}% ≥ ${scaleAtOrAbove}%.` };
  }
  return { objective: 'Hold course: keep compounding small wins on the critical path.', rationale: `health ${c.health}% steady.` };
}

/** Pick the strongest (running, highest health) and weakest (worst status, lowest health). */
function rank(children: ChildState[]): { strongest?: ChildState; weakest?: ChildState } {
  if (children.length === 0) return {};
  const order: Record<LoopStatus, number> = { error: 0, paused: 1, stopped: 2, idle: 3, running: 4 };
  const byStrength = [...children].sort(
    (a, b) => order[b.status] - order[a.status] || b.health - a.health || a.loopId.localeCompare(b.loopId),
  );
  return { strongest: byStrength[0], weakest: byStrength[byStrength.length - 1] };
}

/**
 * Plan one objective per child (pure). Optionally reallocate `reallocateUsd` from the
 * weakest unit to the strongest — net-zero across the org (the CEO reprioritizes between
 * units after the review). The actual cap floor (not below current spend) is applied in
 * {@link setObjective}.
 */
export function planObjectives(children: ChildState[], opts: PlanObjectivesOptions = {}): Objective[] {
  const recoverBelow = opts.recoverBelow ?? 70;
  const scaleAtOrAbove = opts.scaleAtOrAbove ?? 90;
  const reallocate = Math.max(0, opts.reallocateUsd ?? 0);
  const { strongest, weakest } = rank(children);
  const canReallocate = reallocate > 0 && strongest && weakest && strongest.loopId !== weakest.loopId;

  return children.map((c) => {
    const { objective, rationale } = objectiveText(c, recoverBelow, scaleAtOrAbove);
    let budgetDeltaUsd = 0;
    if (canReallocate && c.loopId === strongest!.loopId) budgetDeltaUsd = reallocate;
    else if (canReallocate && c.loopId === weakest!.loopId) budgetDeltaUsd = -reallocate;
    const extra = budgetDeltaUsd > 0 ? ` (+$${budgetDeltaUsd} budget)` : budgetDeltaUsd < 0 ? ` (−$${-budgetDeltaUsd} budget reclaimed)` : '';
    return { loopId: c.loopId, objective: objective + extra, budgetDeltaUsd, rationale };
  });
}

// ── set_objective (driver effect) ──────────────────────────────────────────────

/** The minimal ledger surface set_objective needs (a subset of BudgetLedger). */
export interface ObjectiveLedger {
  registerLoop(config: { orgId: string; loopId: string; hardCapUsd: number }): void;
}

export interface SetObjectiveDeps {
  artifacts: ArtifactPort;
  memory?: MemoryPort;
  ledger?: ObjectiveLedger;
  /** Emits on the CHILD's event stream (the driver stamps seq). */
  emit: (e: Omit<DeptEvent, 'seq'>) => void;
  clock?: Clock;
}

/**
 * Apply one objective to a child: write its CEO-owned STRATEGY.md, seed its memory (so the
 * child's next PLAN recall surfaces the steer), adjust its budget cap (floored so the cap
 * never drops below what's already spent), and emit an `objective` event for HISTORY.
 */
export async function setObjective(
  child: ChildState,
  obj: Objective,
  deps: SetObjectiveDeps,
  eventId: string,
): Promise<{ newBudgetCapUsd: number }> {
  const clock = deps.clock ?? systemClock;
  const newCap = Math.max(child.spentUsd, child.budgetCapUsd + obj.budgetDeltaUsd);

  const strategy =
    `# STRATEGY — set by CEO meta-loop\n\n` +
    `## Objective\n${obj.objective}\n\n` +
    `## Rationale\n${obj.rationale}\n\n` +
    `## Budget\nCap: $${newCap.toFixed(2)}` +
    (obj.budgetDeltaUsd ? ` (${obj.budgetDeltaUsd > 0 ? '+' : '−'}$${Math.abs(obj.budgetDeltaUsd).toFixed(2)})\n` : `\n`);
  await deps.artifacts.write(child.loopId, 'STRATEGY.md', strategy);

  await deps.memory?.append(child.loopId, {
    path: 'STRATEGY.md#objective',
    summary: `CEO objective: ${obj.objective}`,
  });

  if (obj.budgetDeltaUsd !== 0) {
    deps.ledger?.registerLoop({ orgId: child.orgId, loopId: child.loopId, hardCapUsd: newCap });
  }

  deps.emit({
    id: eventId,
    loopId: child.loopId,
    ts: clock.now(),
    kind: 'log',
    payload: {
      level: 'info',
      source: 'objective',
      message: `CEO set_objective: ${obj.objective}${obj.budgetDeltaUsd ? ` — budget → $${newCap.toFixed(2)}` : ''}`,
    },
  });

  return { newBudgetCapUsd: newCap };
}

// ── runCeoReview (driver) ───────────────────────────────────────────────────────

export interface CeoReviewDeps extends SetObjectiveDeps {
  /** Batch runtime for the review fan-out (default {@link FakeBatchReviewRuntime}). */
  batch?: BatchReviewRuntime;
  /** Model tier for the CEO review (default Opus judgment tier). */
  modelId?: 'claude-opus-4-8' | 'claude-fable-5' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
}

export interface CeoReviewResult {
  reviewId: string;
  verdicts: BatchReviewVerdict[];
  objectives: Objective[];
  /** Total USD the batched review cost (priced at the 50% Batch rate). */
  reviewCostUsd: number;
}

/**
 * Run one CEO review over a set of children: pre-warm + batch-grade their summaries,
 * plan objectives, and apply each via set_objective. Returns the batched verdicts +
 * objectives + the (50%-priced) review cost.
 */
export async function runCeoReview(
  ceoLoopId: string,
  children: ChildState[],
  deps: CeoReviewDeps,
  opts: PlanObjectivesOptions & { reviewId?: string } = {},
): Promise<CeoReviewResult> {
  const clock = deps.clock ?? systemClock;
  const batch = deps.batch ?? new FakeBatchReviewRuntime();
  const modelId = deps.modelId ?? 'claude-opus-4-8';
  const reviewId = opts.reviewId ?? `ceo-review-${ceoLoopId}`;

  // A large, stable shared prefix (frozen mission/rubric) — pre-warmed so the batch reads
  // it from cache rather than re-paying for it on every item.
  const sharedPrefix =
    'You are the CEO meta-loop. Grade each department against its mission, health, and ' +
    'budget. Return a one-line steer. Reprioritize between units; never breach a hard cap.';
  await batch.prewarm(sharedPrefix, modelId);

  const verdicts = await batch.review({
    modelId,
    sharedPrefix,
    items: children.map((c) => ({
      loopId: c.loopId,
      summary: `${c.name} (L${c.level}) status=${c.status} health=${c.health}% spent=$${c.spentUsd.toFixed(2)}/$${c.budgetCapUsd.toFixed(2)}. ${c.lastReport ?? ''}`,
    })),
  });

  // The review cost is BATCHED → 50% of the synchronous price (cost lever #3).
  const reviewCostUsd = verdicts.reduce((sum, v) => sum + batchCostOfUsage(v.usage, modelId), 0);

  deps.emit({
    id: `${reviewId}-summary`,
    loopId: ceoLoopId,
    ts: clock.now(),
    kind: 'log',
    payload: {
      level: 'info',
      source: 'ceo',
      message: `CEO review: graded ${children.length} unit(s) via Batch API (50% off) for $${reviewCostUsd.toFixed(4)}.`,
    },
  });

  const objectives = planObjectives(children, opts);
  for (let i = 0; i < objectives.length; i += 1) {
    const obj = objectives[i]!;
    const child = children.find((c) => c.loopId === obj.loopId)!;
    await setObjective(child, obj, deps, `${reviewId}-obj-${i}`);
  }

  return { reviewId, verdicts, objectives, reviewCostUsd };
}
