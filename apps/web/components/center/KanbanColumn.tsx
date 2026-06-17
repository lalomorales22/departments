'use client';

import type { Task, TaskState } from '@departments/shared';
import { TASK_STATE_LABELS } from '@departments/shared';
import { SectionLabel } from '@/components/atoms';
import { accentVar, taskStateAccent } from '@/lib/status-theme';
import { TaskCard } from './TaskCard';

/**
 * One Kanban lane. Header is a SectionLabel (state label + mono count badge) sitting
 * over a thin state-colored underline; the body is a scrollable vertical stack of
 * TaskCards. Empty lanes render a faint dashed placeholder.
 */
export function KanbanColumn({ state, tasks }: { state: TaskState; tasks: Task[] }) {
  const stateColor = accentVar(taskStateAccent[state]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <header className="shrink-0">
        <SectionLabel
          right={
            <span className="font-mono text-2xs tabular text-muted" data-machine>
              {tasks.length}
            </span>
          }
        >
          {TASK_STATE_LABELS[state]}
        </SectionLabel>
        <div className="mt-1 h-px w-full" style={{ backgroundColor: stateColor }} />
      </header>

      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-hairline py-6 text-center font-mono text-2xs uppercase tracking-wide text-faint">
            empty
          </div>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} task={task} />)
        )}
      </div>
    </section>
  );
}
