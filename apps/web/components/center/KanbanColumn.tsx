'use client';

import { useState } from 'react';
import type { DragEvent } from 'react';
import type { Task, TaskState } from '@departments/shared';
import { TASK_STATES, TASK_STATE_LABELS } from '@departments/shared';
import { SectionLabel } from '@/components/atoms';
import { accentVar, taskStateAccent } from '@/lib/status-theme';
import { TaskCard } from './TaskCard';

/**
 * One Kanban lane. Header is a SectionLabel (state label + mono count badge) sitting
 * over a thin state-colored underline; the body is a scrollable vertical stack of
 * TaskCards. Empty lanes render a faint dashed placeholder.
 *
 * Phase 3: the lane is a native HTML5 drop target — dropping a card here moves it to
 * this lane's state via `onMove` (computed as the signed lane-delta from the card's
 * current state). Counts come straight from the (optimistic, local) `tasks` prop.
 */
export function KanbanColumn({
  state,
  tasks,
  onMove,
}: {
  state: TaskState;
  tasks: Task[];
  onMove: (taskId: string, dir: -1 | 1) => void;
}) {
  const stateColor = accentVar(taskStateAccent[state]);
  const [isDropTarget, setIsDropTarget] = useState(false);

  function handleDragOver(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isDropTarget) setIsDropTarget(true);
  }

  function handleDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setIsDropTarget(false);
    const taskId = e.dataTransfer.getData('text/plain');
    // The card carries its origin state (it may be dragged in from another lane).
    const fromState = e.dataTransfer.getData('application/x-task-state') as TaskState;
    if (!taskId || !TASK_STATES.includes(fromState)) return;
    const delta = TASK_STATES.indexOf(state) - TASK_STATES.indexOf(fromState);
    if (delta === 0) return;
    const dir: -1 | 1 = delta < 0 ? -1 : 1;
    // onMove is single-step + clamped; step it until the card lands in this lane.
    for (let i = 0; i < Math.abs(delta); i++) onMove(taskId, dir);
  }

  return (
    <section
      className="flex min-h-0 min-w-0 flex-col"
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={handleDrop}
      aria-label={`${TASK_STATE_LABELS[state]} lane, ${tasks.length} tasks`}
    >
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

      <div
        className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5 rounded-sm transition-shadow"
        style={isDropTarget ? { boxShadow: `inset 0 0 0 1px ${stateColor}` } : undefined}
      >
        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-hairline py-6 text-center font-mono text-2xs uppercase tracking-wide text-faint">
            empty
          </div>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} task={task} onMove={onMove} />)
        )}
      </div>
    </section>
  );
}
