import { describe, expect, it } from 'vitest';
import type { Loop, LoopStatus, LoopTreeNode } from '@departments/shared';
import { rollup, rollupForest, flattenRollup, aggregate } from './rollup.js';

let n = 0;
function loop(over: Partial<Loop> & { id: string }): Loop {
  return {
    orgId: 'org',
    parentLoopId: null,
    name: over.id,
    displayName: over.id,
    level: 1,
    mission: 'm',
    status: 'idle',
    health: 100,
    phase: null,
    cycleCount: 0,
    cadence: 'manual',
    cmaAgentId: null,
    memoryStoreId: null,
    repoUrl: null,
    budgetCapUsd: 100,
    spentUsd: 10,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  } as Loop;
}

function node(l: Loop, children: LoopTreeNode[] = []): LoopTreeNode {
  return { loop: l, children };
}

describe('rollup — aggregate health/spend/status up the tree', () => {
  it('averages health and sums spend/budget across the subtree', () => {
    const tree = node(loop({ id: 'ceo', level: 1, health: 90, spentUsd: 100, budgetCapUsd: 1000 }), [
      node(loop({ id: 'a', level: 2, health: 80, spentUsd: 50, budgetCapUsd: 500 })),
      node(loop({ id: 'b', level: 2, health: 70, spentUsd: 20, budgetCapUsd: 200 }), [
        node(loop({ id: 'b1', level: 3, health: 60, spentUsd: 5, budgetCapUsd: 100 })),
      ]),
    ]);
    const r = rollup(tree);
    expect(r.ownHealth).toBe(90);
    // mean(90, 80, 70, 60) = 75
    expect(r.rolledHealth).toBe(75);
    expect(r.rolledSpentUsd).toBe(175); // 100 + 50 + 20 + 5
    expect(r.rolledBudgetUsd).toBe(1800); // 1000 + 500 + 200 + 100
    expect(r.descendantCount).toBe(3);
  });

  it('surfaces the most attention-needing status to the parent', () => {
    const tree = node(loop({ id: 'ceo', status: 'running' }), [
      node(loop({ id: 'a', status: 'idle' })),
      node(loop({ id: 'b', status: 'error' })),
    ]);
    expect(rollup(tree).rolledStatus).toBe('error');

    const calm = node(loop({ id: 'ceo2', status: 'idle' }), [node(loop({ id: 'c', status: 'running' }))]);
    expect(rollup(calm).rolledStatus).toBe('running');
  });

  it('honors a live health resolver override', () => {
    const tree = node(loop({ id: 'x', health: 50 }));
    const r = rollup(tree, (id) => (id === 'x' ? 88 : undefined));
    expect(r.ownHealth).toBe(88);
    expect(r.rolledHealth).toBe(88);
  });
});

describe('flattenRollup + aggregate', () => {
  it('counts each loop once and builds a status histogram', () => {
    const forest = rollupForest([
      node(loop({ id: 'ceo', status: 'running', health: 90, spentUsd: 100 }), [
        node(loop({ id: 'a', status: 'paused', health: 60, spentUsd: 40 })),
      ]),
    ]);
    expect(flattenRollup(forest[0]!)).toHaveLength(2);
    const agg = aggregate(forest);
    expect(agg.loopCount).toBe(2);
    expect(agg.avgHealth).toBe(75); // mean(90,60)
    expect(agg.totalSpentUsd).toBe(140);
    const byStatus: Record<LoopStatus, number> = agg.byStatus;
    expect(byStatus.running).toBe(1);
    expect(byStatus.paused).toBe(1);
  });
});
