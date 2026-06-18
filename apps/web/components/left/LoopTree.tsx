'use client';

import { useMemo } from 'react';
import { SectionLabel } from '@/components/atoms';
import { buildLoopTree, LOOPS } from '@/lib/fixtures';
import { useLiveHealth } from '@/lib/live';
import { useCockpit } from '@/lib/store';
import { rollupForest } from '@/lib/tree';
import { LoopTreeNode } from './LoopTreeNode';

/**
 * The loop hierarchy panel: a HIERARCHY label with the loop count, then the recursively
 * rendered tree bound to the ROLLED-UP state (each parent shows aggregate health/status
 * for its whole subtree; the CEO root wears a crown). The selected loop's LIVE health is
 * overlaid into the rollup so its number tracks the running engine; every other loop uses
 * its fixture health (unselected loops have no live subscription — the Phase-3 gotcha).
 */
export function LoopTree() {
  const selectedLoopId = useCockpit((s) => s.selectedLoopId);
  const { health: liveHealth, live } = useLiveHealth(selectedLoopId);

  const roots = useMemo(() => {
    const healthOf = (id: string) => (live && id === selectedLoopId ? liveHealth : undefined);
    return rollupForest(buildLoopTree(), healthOf);
  }, [selectedLoopId, liveHealth, live]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pb-1.5 pt-3">
        <SectionLabel
          right={<span className="font-mono text-2xs tabular text-faint">{LOOPS.length}</span>}
        >
          Hierarchy
        </SectionLabel>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {roots.map((node) => (
          <LoopTreeNode key={node.loop.id} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}
