/**
 * @departments/artifacts — files-as-memory in a per-loop Git repo.
 *
 * `GitArtifactStore` is the real, git-backed `ArtifactPort` the engine wires at its
 * composition root: provision a repo per loop, seed README/TASKS/HANDOFF on cold
 * start, and snapshot+tag the working tree after each phase — reporting whether the
 * change was MEANINGFUL (excluding the always-rewritten HANDOFF.md) so the
 * no-progress detector can't be defeated.
 */
export {
  GitArtifactStore,
  defaultArtifactsRoot,
  sanitizeTag,
  type ArtifactSnapshot,
  type ArtifactPortShape,
  type GitArtifactStoreOptions,
  type SnapshotMeta,
} from './git-store';
