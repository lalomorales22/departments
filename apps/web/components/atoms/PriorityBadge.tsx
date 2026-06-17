import type { TaskPriority } from '@departments/shared';
import { accentVar, priorityAccent } from '@/lib/status-theme';
import { cn } from '@/lib/cn';

/** P1/P2/P3 badge colored by priority (P1 red, P2 amber, P3 blue). */
export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  const color = accentVar(priorityAccent[priority]);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-1 font-mono text-2xs font-medium',
        className,
      )}
      style={{
        color,
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
      }}
    >
      {priority}
    </span>
  );
}
