'use client';

import { SectionLabel } from '@/components/atoms';
import { buildLoopTree, LOOPS } from '@/lib/fixtures';
import { LoopTreeNode } from './LoopTreeNode';

/**
 * The loop hierarchy panel: a HIERARCHY section label with the total loop count,
 * then the recursively-rendered tree. Scrollable so deep trees stay contained.
 */
export function LoopTree() {
  const roots = buildLoopTree();

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
