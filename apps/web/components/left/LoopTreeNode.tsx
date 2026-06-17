'use client';

import type { LoopTreeNode as LoopTreeNodeT } from '@departments/shared';
import { ChevronDown, ChevronRight, MoreVertical } from 'lucide-react';
import { useState } from 'react';
import { StatusDot } from '@/components/atoms';
import { cn } from '@/lib/cn';
import { isLiveLoopStatus, loopStatusAccent } from '@/lib/status-theme';
import { useCockpit } from '@/lib/store';

/**
 * One recursive row in the loop hierarchy. Indents by depth, shows a collapse
 * chevron when it has children, a status dot (live = glow + pulse), the display
 * name, a mono level tag (L1..L4), and a hover-only kebab. Selecting the row focuses
 * the loop. Children render recursively while expanded (default expanded).
 */
export function LoopTreeNode({ node, depth }: { node: LoopTreeNodeT; depth: number }) {
  const { loop, children } = node;
  const selectedLoopId = useCockpit((s) => s.selectedLoopId);
  const setSelectedLoop = useCockpit((s) => s.setSelectedLoop);
  const [expanded, setExpanded] = useState(true);

  const hasChildren = children.length > 0;
  const selected = selectedLoopId === loop.id;
  const accent = loopStatusAccent[loop.status];
  const live = isLiveLoopStatus(loop.status);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-current={selected ? 'true' : undefined}
        onClick={() => setSelectedLoop(loop.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelectedLoop(loop.id);
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

        <StatusDot accent={accent} live={live} size={6} />

        <span className="min-w-0 flex-1 truncate text-sm leading-none">{loop.displayName}</span>

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
