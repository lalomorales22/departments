'use client';

import type { Task, TaskState } from '@departments/shared';
import { TASK_STATES } from '@departments/shared';
import { SectionLabel } from '@/components/atoms';
import { getTasks } from '@/lib/fixtures';
import { KanbanColumn } from './KanbanColumn';

/**
 * The TASK BOARD: four fixed lanes in TASK_STATES order (todo / in_progress / review
 * / done), each fed by the loop's tasks filtered to that state. For the marketing
 * fixture the lane counts read 5 / 4 / 2 / 4. Presentational in Phase 1 — the lane
 * structure is laid out so Phase 3 drag-and-drop drops in cleanly.
 */
export function KanbanBoard({ loopId }: { loopId: string }) {
  const tasks = getTasks(loopId);
  const byState: Record<TaskState, Task[]> = {
    todo: [],
    in_progress: [],
    review: [],
    done: [],
  };
  for (const task of tasks) {
    byState[task.state].push(task);
  }

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
          <KanbanColumn key={state} state={state} tasks={byState[state]} />
        ))}
      </div>
    </div>
  );
}
