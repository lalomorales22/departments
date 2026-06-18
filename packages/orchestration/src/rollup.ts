/**
 * rollup.ts — HEALTH / SPEND / STATUS ROLLUP up the loop tree (Phase 4 hierarchy).
 *
 * A CEO supervising `marketing ← comedeez ← content-creator ← workers` must see the
 * AGGREGATE of everything beneath it, not just its own number. This module folds a
 * {@link LoopTreeNode} forest into {@link RollupNode}s carrying both the loop's own
 * value and the rolled-up value across its whole subtree:
 *   - health  → mean of every loop's own health in the subtree (equal weight per loop);
 *   - spend / budget → sums across the subtree;
 *   - status  → the most attention-needing status in the subtree
 *               (error > paused > running > idle > stopped).
 *
 * Pure + deterministic. The driver emits a parent's rolled health as a `metric` event
 * (reusing the frozen protocol — no new event kind); the cockpit tree binds to these.
 */
import type { LoopStatus, LoopTreeNode } from '@departments/shared';

export interface RollupNode {
  loopId: string;
  name: string;
  level: number;
  ownHealth: number;
  /** Mean own-health across this loop + all descendants (0–100, rounded). */
  rolledHealth: number;
  ownStatus: LoopStatus;
  /** Most attention-needing status across the subtree. */
  rolledStatus: LoopStatus;
  ownSpentUsd: number;
  rolledSpentUsd: number;
  ownBudgetUsd: number;
  rolledBudgetUsd: number;
  /** Number of descendants (excludes self). */
  descendantCount: number;
  children: RollupNode[];
}

/** Status severity — higher surfaces to the parent in {@link RollupNode.rolledStatus}. */
const STATUS_SEVERITY: Readonly<Record<LoopStatus, number>> = {
  error: 4,
  paused: 3,
  running: 2,
  idle: 1,
  stopped: 0,
};

function worseStatus(a: LoopStatus, b: LoopStatus): LoopStatus {
  return STATUS_SEVERITY[a] >= STATUS_SEVERITY[b] ? a : b;
}

/** Optional override for a loop's live health (e.g. the live `health` metric). */
export type HealthResolver = (loopId: string) => number | undefined;

interface SubtreeAcc {
  node: RollupNode;
  healthSum: number;
  loopCount: number;
}

function fold(node: LoopTreeNode, healthOf?: HealthResolver): SubtreeAcc {
  const loop = node.loop;
  const ownHealth = healthOf?.(loop.id) ?? loop.health;

  let healthSum = ownHealth;
  let loopCount = 1;
  let rolledStatus = loop.status;
  let rolledSpent = loop.spentUsd;
  let rolledBudget = loop.budgetCapUsd;
  let descendantCount = 0;
  const children: RollupNode[] = [];

  for (const childNode of node.children) {
    const sub = fold(childNode, healthOf);
    children.push(sub.node);
    healthSum += sub.healthSum;
    loopCount += sub.loopCount;
    rolledStatus = worseStatus(rolledStatus, sub.node.rolledStatus);
    rolledSpent += sub.node.rolledSpentUsd;
    rolledBudget += sub.node.rolledBudgetUsd;
    descendantCount += sub.loopCount;
  }

  const out: RollupNode = {
    loopId: loop.id,
    name: loop.displayName,
    level: loop.level,
    ownHealth,
    rolledHealth: Math.round(healthSum / loopCount),
    ownStatus: loop.status,
    rolledStatus,
    ownSpentUsd: loop.spentUsd,
    rolledSpentUsd: rolledSpent,
    ownBudgetUsd: loop.budgetCapUsd,
    rolledBudgetUsd: rolledBudget,
    descendantCount,
    children,
  };
  return { node: out, healthSum, loopCount };
}

/** Roll up a single tree node (and its subtree). */
export function rollup(node: LoopTreeNode, healthOf?: HealthResolver): RollupNode {
  return fold(node, healthOf).node;
}

/** Roll up a forest (the tree's top-level roots). */
export function rollupForest(nodes: LoopTreeNode[], healthOf?: HealthResolver): RollupNode[] {
  return nodes.map((n) => rollup(n, healthOf));
}

/** Flatten a rollup subtree into a depth-first list (self first). */
export function flattenRollup(node: RollupNode): RollupNode[] {
  return [node, ...node.children.flatMap(flattenRollup)];
}

export interface OrgAggregate {
  loopCount: number;
  avgHealth: number;
  totalSpentUsd: number;
  totalBudgetUsd: number;
  byStatus: Record<LoopStatus, number>;
}

/**
 * Org-wide aggregate over a rollup forest (for the ANALYTICS tab): loop count, mean
 * health, total spend/budget, and a status histogram. Sums each loop ONCE (walks the
 * flattened forest, not the already-rolled subtree sums).
 */
export function aggregate(forest: RollupNode[]): OrgAggregate {
  const all = forest.flatMap(flattenRollup);
  const byStatus: Record<LoopStatus, number> = { running: 0, idle: 0, paused: 0, stopped: 0, error: 0 };
  let healthSum = 0;
  let totalSpentUsd = 0;
  let totalBudgetUsd = 0;
  for (const n of all) {
    healthSum += n.ownHealth;
    totalSpentUsd += n.ownSpentUsd;
    totalBudgetUsd += n.ownBudgetUsd;
    byStatus[n.ownStatus] += 1;
  }
  return {
    loopCount: all.length,
    avgHealth: all.length ? Math.round(healthSum / all.length) : 0,
    totalSpentUsd,
    totalBudgetUsd,
    byStatus,
  };
}
