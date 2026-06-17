'use client';

import type { Task } from '@departments/shared';
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
 * Presentational only — Phase 3 wires drag/drop.
 */
export function TaskCard({ task }: { task: Task }) {
  const selectedAgentId = useCockpit((s) => s.selectedAgentId);

  const stateColor = accentVar(taskStateAccent[task.state]);
  const assignee = task.assigneeId ? getAgent(task.assigneeId) : undefined;
  const initials = assignee ? initialsOf(assignee.name) : '—';
  const isSelectedAssignee =
    task.assigneeId != null && task.assigneeId === selectedAgentId;

  const tags = task.tags ?? [];
  const shownTags = tags.slice(0, 2);

  return (
    <article
      data-task-id={task.id}
      className={cn(
        'group relative rounded-sm border border-hairline bg-surface-2 pl-2.5 pr-2 py-2',
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
