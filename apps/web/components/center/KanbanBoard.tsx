'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Task, TaskState } from '@departments/shared';
import { TASK_STATES } from '@departments/shared';
import { SectionLabel } from '@/components/atoms';
import { getTasks } from '@/lib/fixtures';
import { KanbanColumn } from './KanbanColumn';

/**
 * The TASK BOARD: four fixed lanes in TASK_STATES order (todo / in_progress / review
 * / done), each fed by the loop's tasks filtered to that state. For the marketing
 * fixture the lane counts read 5 / 4 / 2 / 4.
 *
 * Phase 3 makes the board interactive: tasks are seeded from the fixture into LOCAL
 * state, and `moveTask` shifts a card one lane left/right (drag/drop or keyboard),
 * updating the lane + header counts OPTIMISTICALLY. The frozen Event protocol has no
 * task event source, so there is nothing to reconcile against yet — true remote
 * reconciliation (rebasing optimistic moves on server truth) arrives with a tasks
 * projection, which is out of the frozen Event protocol.
 */
export function KanbanBoard({ loopId }: { loopId: string }) {
  // Local, optimistic copy of the loop's tasks; re-seeded when the loop changes.
  const [tasks, setTasks] = useState<Task[]>(() => getTasks(loopId));
  useEffect(() => {
    setTasks(getTasks(loopId));
  }, [loopId]);

  /**
   * Optimistically move a task one lane across TASK_STATES (clamped to the ends).
   * No remote write — see the reconciliation note above.
   */
  function moveTask(taskId: string, dir: -1 | 1) {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== taskId) return task;
        const idx = TASK_STATES.indexOf(task.state);
        const next = Math.min(TASK_STATES.length - 1, Math.max(0, idx + dir));
        if (next === idx) return task;
        return { ...task, state: TASK_STATES[next] as TaskState };
      }),
    );
  }

  const byState = useMemo(() => {
    const grouped: Record<TaskState, Task[]> = {
      todo: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const task of tasks) {
      grouped[task.state].push(task);
    }
    return grouped;
  }, [tasks]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pt-3">
        <SectionLabel
          right={
            <span className="font-mono text-2xs tabular text-muted" data-machine>
              {tasks.length} TASKS
            </span>
          }
        >
          TASK BOARD
        </SectionLabel>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3 px-3 pb-3 pt-3">
        {TASK_STATES.map((state) => (
          <KanbanColumn
            key={state}
            state={state}
            tasks={byState[state]}
            onMove={moveTask}
          />
        ))}
      </div>
    </div>
  );
}
