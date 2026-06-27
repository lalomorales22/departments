import type { MemoryItem } from '@departments/shared';

/**
 * Distilled memory. The Inspector reads a loop's REAL memory (JSONL) from
 * `/api/loops/:id/inspect` once it has run; this static seed is empty. No mock data.
 */
export const MEMORY: MemoryItem[] = [];

export function getMemory(_loopId: string): MemoryItem[] {
  return MEMORY;
}
