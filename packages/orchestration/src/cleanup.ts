/**
 * Loop-stop cleanup (Phase 5) — archive sessions, free containers, reuse environments
 * so a stopped/paused/completed loop never leaves orphaned resources.
 *
 * The engine already ends each phase's session (`runtime.endSession`) and releases the
 * concurrency-semaphore slot in a `finally`. This port is the loop-level hook the
 * composition root wires to the real teardown: archive the CMA session(s), free the
 * container, return the environment to the pool. Local/test runs use
 * {@link InMemoryCleanup}; the durable Temporal path archives via a CMA activity.
 */

/** Why a loop reached a cleanup boundary. */
export type CleanupReason = 'completed' | 'paused' | 'no_progress' | 'stopped';

export interface CleanupContext {
  loopId: string;
  runId: string;
  cycle: number;
  reason: CleanupReason;
  /** Provider session ids to archive/free, if the runtime surfaced them. */
  sessionIds?: string[];
}

/** Archive sessions + free resources at a loop boundary (no orphaned resources). */
export interface CleanupPort {
  archive(ctx: CleanupContext): void | Promise<void>;
}

/** Records cleanup calls for tests/inspection; frees nothing real. */
export class InMemoryCleanup implements CleanupPort {
  readonly archived: CleanupContext[] = [];
  async archive(ctx: CleanupContext): Promise<void> {
    this.archived.push(ctx);
  }
}

/** A no-op cleanup (the default when none is wired). */
export const noopCleanup: CleanupPort = { archive() {} };
