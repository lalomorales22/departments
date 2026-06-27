import type { DeptEvent } from '@departments/events';

/**
 * Log backlog. The console renders the loop's REAL streamed events (and persisted history
 * via the SSE replay); there is no synthetic seed. Empty until a loop runs. No mock data.
 */
export const LOGS: DeptEvent[] = [];

export function getLogs(_loopId: string): DeptEvent[] {
  return LOGS;
}
