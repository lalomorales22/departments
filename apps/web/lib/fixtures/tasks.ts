import type { Task } from '@departments/shared';

/**
 * Kanban tasks. There is no real task projection outside the frozen Event protocol yet
 * (a loop's TASKS.md isn't parsed into board cards), so this is intentionally empty — the
 * board shows an honest empty-state until that projection lands. No mock data.
 */
export const TASKS: Task[] = [];

export function getTasks(_loopId: string): Task[] {
  return TASKS;
}
