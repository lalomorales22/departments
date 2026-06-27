'use client';

import { useMemo } from 'react';
import { SectionLabel } from '@/components/atoms';
import { useLoops, useLoopTree, useLoopsLoaded } from '@/lib/loops-client';
import { useLiveHealth } from '@/lib/live';
import { useCockpit } from '@/lib/store';
import { rollupForest } from '@/lib/tree';
import { LoopTreeNode } from './LoopTreeNode';

/**
 * The loop hierarchy panel: a HIERARCHY label with the loop count, then the recursively
 * rendered tree bound to the ROLLED-UP state (each parent shows aggregate health/status
 * for its whole subtree). Loops come from the REAL registry; the selected loop's LIVE
 * health is overlaid so its number tracks the running engine. Empty until you create one.
 */
export function LoopTree() {
  const selectedLoopId = useCockpit((s) => s.selectedLoopId);
  const { health: liveHealth, live } = useLiveHealth(selectedLoopId);
  const tree = useLoopTree();
  const loops = useLoops();
  const loaded = useLoopsLoaded();

  const roots = useMemo(() => {
    const healthOf = (id: string) => (live && id === selectedLoopId ? liveHealth : undefined);
    return rollupForest(tree, healthOf);
  }, [tree, selectedLoopId, liveHealth, live]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pb-1.5 pt-3">
        <SectionLabel right={<span className="font-mono text-2xs tabular text-faint">{loops.length}</span>}>
          Hierarchy
        </SectionLabel>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {roots.length === 0 ? (
          <div className="mt-6 px-3 text-center">
            <p className="text-2xs leading-relaxed text-faint">
              {loaded ? 'No departments yet.' : 'Loading…'}
            </p>
            {loaded && (
              <p className="mt-2 text-2xs leading-relaxed text-muted">
                Type <span className="font-mono text-accent-cyan">loop &lt;name&gt;</span> in the bar below to
                create your first department.
              </p>
            )}
          </div>
        ) : (
          roots.map((node) => <LoopTreeNode key={node.loop.id} node={node} depth={0} />)
        )}
      </div>
    </div>
  );
}
