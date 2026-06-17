'use client';

import type { DragEvent, KeyboardEvent } from 'react';
import type { Task } from '@departments/shared';
import { TASK_STATE_LABELS } from '@departments/shared';
import { PriorityBadge, TagChip } from '@/components/atoms';
import { getAgent } from '@/lib/fixtures';
import { useCockpit } from '@/lib/store';
import { accentVar, taskStateAccent } from '@/lib/status-theme';
import { cn } from '@/lib/cn';

/** Derive up-to-2-letter initials from an agent display name (e.g. "Market Researcher" -> "MR"). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) {
    const first = parts[0] ?? '';
    return (first.slice(0, 2) || '??').toUpperCase();
  }
  const a = parts[0]?.[0] ?? '';
  const b = parts[parts.length - 1]?.[0] ?? '';
  return (a + b).toUpperCase();
}

/**
 * A single Kanban task card. Left accent border is colored by the task's state; when
 * the card's assignee is the selected agent it lifts with a rationed cyan ring + glow.
 *
 * Phase 3 interaction: the card is focusable + keyboard-movable across lanes
 * (ArrowLeft/ArrowRight or [ / ]) and is a native HTML5 drag source carrying its id
 * and origin state so a lane can compute the move on drop. Moves are optimistic and
 * local — see the reconciliation note in KanbanBoard.
 */
export function TaskCard({
  task,
  onMove,
}: {
  task: Task;
  onMove: (taskId: string, dir: -1 | 1) => void;
}) {
  const selectedAgentId = useCockpit((s) => s.selectedAgentId);

  const stateColor = accentVar(taskStateAccent[task.state]);
  const assignee = task.assigneeId ? getAgent(task.assigneeId) : undefined;
  const initials = assignee ? initialsOf(assignee.name) : '—';
  const isSelectedAssignee =
    task.assigneeId != null && task.assigneeId === selectedAgentId;

  const tags = task.tags ?? [];
  const shownTags = tags.slice(0, 2);

  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'ArrowLeft' || e.key === '[') {
      e.preventDefault();
      onMove(task.id, -1);
    } else if (e.key === 'ArrowRight' || e.key === ']') {
      e.preventDefault();
      onMove(task.id, 1);
    }
  }

  function handleDragStart(e: DragEvent<HTMLElement>) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
    // Origin state lets the drop lane compute the signed move distance.
    e.dataTransfer.setData('application/x-task-state', task.state);
  }

  return (
    <article
      data-task-id={task.id}
      tabIndex={0}
      role="button"
      draggable
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStart}
      aria-label={`Task: ${task.title}. Lane ${TASK_STATE_LABELS[task.state]}. Press left or right arrow to move between lanes.`}
      className={cn(
        'focus-ring group relative rounded-sm border border-hairline bg-surface-2 pl-2.5 pr-2 py-2',
        'transition-colors hover:border-hairline-strong',
        isSelectedAssignee && 'ring-1',
      )}
      style={{
        borderLeftWidth: 2,
        borderLeftColor: stateColor,
        ...(isSelectedAssignee
          ? {
              boxShadow: 'var(--glow-cyan)',
              ['--tw-ring-color' as string]: accentVar('cyan'),
            }
          : null),
      }}
    >
      {/* top row: priority + area chip */}
      <div className="flex items-center justify-between gap-2">
        <PriorityBadge priority={task.priority} />
        <TagChip className="uppercase tracking-wide">{task.area}</TagChip>
      </div>

      {/* title */}
      <h4 className="mt-1.5 line-clamp-2 text-sm leading-snug text-text">{task.title}</h4>

      {/* footer: assignee avatar + tags */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border font-mono text-2xs tabular',
            isSelectedAssignee
              ? 'border-hairline-strong text-accent-cyan'
              : 'border-hairline bg-surface-3 text-muted',
          )}
          title={assignee?.name ?? 'Unassigned'}
          aria-label={assignee ? `Assignee ${assignee.name}` : 'Unassigned'}
        >
          {initials}
        </span>
        {shownTags.length > 0 && (
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            {shownTags.map((t) => (
              <TagChip key={t}>{t}</TagChip>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
