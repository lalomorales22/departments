'use client';

import { ChevronDown, ChevronRight, Crown, MoreVertical } from 'lucide-react';
import { useState } from 'react';
import { StatusDot } from '@/components/atoms';
import { cn } from '@/lib/cn';
import { accentVar, isLiveLoopStatus, loopStatusAccent } from '@/lib/status-theme';
import { useCockpit } from '@/lib/store';
import { isCeoLoop, type TreeRollup } from '@/lib/tree';

/** Health → accent: a quick read of how a unit (or its subtree) is doing. */
function healthAccent(h: number): 'green' | 'amber' | 'red' {
  return h >= 85 ? 'green' : h >= 60 ? 'amber' : 'red';
}

/**
 * One recursive row in the loop hierarchy, bound to the ROLLED-UP state. A parent's
 * status dot reflects the most attention-needing status in its subtree (an error/paused
 * descendant surfaces upward), while the glow stays honest (only a loop whose OWN status
 * is running glows). Each row shows a rolled health % (own % for leaves); the CEO root
 * wears a purple crown. Selecting a row focuses the loop.
 */
export function LoopTreeNode({ node, depth }: { node: TreeRollup; depth: number }) {
  const { loop, children } = node;
  const selectedLoopId = useCockpit((s) => s.selectedLoopId);
  const enterLoop = useCockpit((s) => s.enterLoop);
  const [expanded, setExpanded] = useState(true);

  const hasChildren = children.length > 0;
  const selected = selectedLoopId === loop.id;
  const ceo = isCeoLoop(loop);
  // Dot color = rolled (worst) status; glow = this loop's OWN liveness only.
  const accent = ceo ? 'purple' : loopStatusAccent[node.rolledStatus];
  const live = isLiveLoopStatus(loop.status);
  const shownHealth = hasChildren ? node.rolledHealth : loop.health;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-current={selected ? 'true' : undefined}
        onClick={() => enterLoop(loop.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            enterLoop(loop.id);
          }
        }}
        style={{ paddingLeft: 8 + depth * 14 }}
        className={cn(
          'group relative flex h-7 cursor-pointer items-center gap-1.5 rounded-sm pr-1.5 transition-colors focus-ring',
          selected
            ? 'border-l-2 border-accent-cyan bg-surface-2 text-text shadow-glow-cyan'
            : 'border-l-2 border-transparent text-muted hover:bg-surface-2/60 hover:text-text',
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={hasChildren ? (expanded ? 'Collapse' : 'Expand') : undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded((v) => !v);
          }}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-faint',
            hasChildren ? 'hover:text-text' : 'pointer-events-none opacity-0',
          )}
        >
          {hasChildren &&
            (expanded ? (
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
            ))}
        </button>

        {ceo ? (
          <Crown
            className="h-3.5 w-3.5 shrink-0"
            strokeWidth={2}
            style={{ color: accentVar('purple') }}
            aria-label="CEO meta-loop"
          />
        ) : (
          <StatusDot accent={accent} live={live} size={6} />
        )}

        <span className="min-w-0 flex-1 truncate text-sm leading-none">{loop.displayName}</span>

        {/* rolled-up health % (own % for leaves) — colored by health band */}
        <span
          className="shrink-0 font-mono text-2xs tabular"
          style={{ color: accentVar(healthAccent(shownHealth)) }}
          title={hasChildren ? `rolled health across ${node.descendantCount + 1} loops` : 'loop health'}
        >
          {shownHealth}%
        </span>

        <span className="shrink-0 font-mono text-2xs tabular text-faint">L{loop.level}</span>

        <button
          type="button"
          tabIndex={-1}
          aria-label="Loop actions"
          onClick={(e) => e.stopPropagation()}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-faint opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
        >
          <MoreVertical className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      {hasChildren && expanded && (
        <div>
          {children.map((child) => (
            <LoopTreeNode key={child.loop.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
