import type { Loop, LoopTreeNode } from '@departments/shared';

/**
 * The loop registry moved to the real, SQLite-backed `lib/loops-client` (hooks: useLoops /
 * useLoopById / useLoopTree). These remain only as empty back-compat shims so any
 * un-migrated import still compiles and yields nothing — there is NO mock loop data here.
 * Org/Commander identity lives in `lib/workspace`.
 */
export { LOCAL_ORG as ORG, LOCAL_COMMANDER as COMMANDER } from '../workspace';

export const LOOPS: Loop[] = [];

export function getLoop(_id: string): Loop | undefined {
  return undefined;
}

export function buildLoopTree(): LoopTreeNode[] {
  return [];
}
