/**
 * Client-side TREE ROLLUP — the cockpit's mirror of `@departments/orchestration`'s
 * pure `rollup`. The orchestration package is node-run (it can't cross Next's webpack
 * boundary), so the same fold lives here over the fixture tree: per loop, the rolled-up
 * health (mean own-health across the subtree), spend/budget sums, descendant count, and
 * the most attention-needing status. Only the SELECTED loop has a live subscription, so
 * `healthOf` overrides health for loops we actually have live data for; everything else
 * falls back to the fixture value (the Phase-3 gotcha).
 */
import type { Loop, LoopStatus, LoopTreeNode } from '@departments/shared';

export interface TreeRollup {
  loop: Loop;
  /** Mean own-health across this loop + all descendants (0–100, rounded). */
  rolledHealth: number;
  /** Most attention-needing status across the subtree. */
  rolledStatus: LoopStatus;
  rolledSpentUsd: number;
  rolledBudgetUsd: number;
  /** Descendants (excludes self). */
  descendantCount: number;
  children: TreeRollup[];
}

const SEVERITY: Record<LoopStatus, number> = { error: 4, paused: 3, running: 2, idle: 1, stopped: 0 };
const worse = (a: LoopStatus, b: LoopStatus): LoopStatus => (SEVERITY[a] >= SEVERITY[b] ? a : b);

export type HealthResolver = (loopId: string) => number | undefined;

interface Acc {
  node: TreeRollup;
  healthSum: number;
  count: number;
}

function fold(node: LoopTreeNode, healthOf?: HealthResolver): Acc {
  const { loop } = node;
  const ownHealth = healthOf?.(loop.id) ?? loop.health;
  let healthSum = ownHealth;
  let count = 1;
  let rolledStatus = loop.status;
  let rolledSpentUsd = loop.spentUsd;
  let rolledBudgetUsd = loop.budgetCapUsd;
  let descendantCount = 0;
  const children: TreeRollup[] = [];

  for (const childNode of node.children) {
    const sub = fold(childNode, healthOf);
    children.push(sub.node);
    healthSum += sub.healthSum;
    count += sub.count;
    rolledStatus = worse(rolledStatus, sub.node.rolledStatus);
    rolledSpentUsd += sub.node.rolledSpentUsd;
    rolledBudgetUsd += sub.node.rolledBudgetUsd;
    descendantCount += sub.count;
  }

  return {
    node: {
      loop,
      rolledHealth: Math.round(healthSum / count),
      rolledStatus,
      rolledSpentUsd,
      rolledBudgetUsd,
      descendantCount,
      children,
    },
    healthSum,
    count,
  };
}

export function rollupTree(node: LoopTreeNode, healthOf?: HealthResolver): TreeRollup {
  return fold(node, healthOf).node;
}

export function rollupForest(nodes: LoopTreeNode[], healthOf?: HealthResolver): TreeRollup[] {
  return nodes.map((n) => rollupTree(n, healthOf));
}

export function flattenRollup(t: TreeRollup): TreeRollup[] {
  return [t, ...t.children.flatMap(flattenRollup)];
}

/** Index a forest by loopId for O(1) lookup while rendering the tree. */
export function indexRollup(forest: TreeRollup[]): Map<string, TreeRollup> {
  const map = new Map<string, TreeRollup>();
  for (const t of forest) for (const n of flattenRollup(t)) map.set(n.loop.id, n);
  return map;
}

export interface OrgAggregate {
  loopCount: number;
  avgHealth: number;
  totalSpentUsd: number;
  totalBudgetUsd: number;
  byStatus: Record<LoopStatus, number>;
}

export function aggregate(forest: TreeRollup[]): OrgAggregate {
  const all = forest.flatMap(flattenRollup);
  const byStatus: Record<LoopStatus, number> = { running: 0, idle: 0, paused: 0, stopped: 0, error: 0 };
  let healthSum = 0;
  let totalSpentUsd = 0;
  let totalBudgetUsd = 0;
  for (const n of all) {
    healthSum += n.loop.health;
    totalSpentUsd += n.loop.spentUsd;
    totalBudgetUsd += n.loop.budgetCapUsd;
    byStatus[n.loop.status] += 1;
  }
  return {
    loopCount: all.length,
    avgHealth: all.length ? Math.round(healthSum / all.length) : 0,
    totalSpentUsd,
    totalBudgetUsd,
    byStatus,
  };
}

/** Whether a loop is the org's CEO root (top of the tree). */
export function isCeoLoop(loop: Loop): boolean {
  return loop.parentLoopId === null && (loop.name === 'ceo' || loop.level === 1);
}
