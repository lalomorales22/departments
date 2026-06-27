import type { Artifact } from '@departments/shared';

/**
 * Loop artifacts. The Inspector reads a loop's REAL artifacts from the git working tree
 * via `/api/loops/:id/inspect` once it has run; this static seed is empty. No mock data.
 */
export const ARTIFACTS: Artifact[] = [];

export function getArtifacts(_loopId: string): Artifact[] {
  return ARTIFACTS;
}
