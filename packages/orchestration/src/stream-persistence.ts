/**
 * stream-persistence.ts — a `PersistencePort` that tees the engine's event feed into
 * the realtime spine's {@link EventStream} (Redis Streams / in-memory).
 *
 * This is the PRODUCTION composition of the persistence seam: the engine stamps a
 * monotonic per-loop `seq` via {@link PersistencePort.nextSeq} and forwards each event
 * to {@link PersistencePort.recordEvent}; here that becomes an `EventStream.append`
 * (plus optional `onEvent`/`onRun` passthrough for NDJSON / audit writes). Crucially,
 * the seq counter is SEEDED from `EventStream.lastSeq(loopId)` so `(loopId, seq)` stays
 * monotonic across process restarts when the stream is durable (Redis) — the structural
 * precondition for resume-after-restart.
 *
 * The local web path doesn't use this (it streams NDJSON and the SERVER re-stamps the
 * authoritative seq on ingest); this adapter is for the engine→Redis direct path and is
 * unit-tested against `InMemoryEventStream`.
 */
import type { DeptEvent } from '@departments/events';
import type { EventStream } from '@departments/realtime';
import type { PersistencePort, RunRecord } from './ports.js';

export interface StreamPersistenceOptions {
  stream: EventStream;
  /**
   * Per-loop starting seq, normally `lastSeq(loopId) + 1`, awaited at the composition
   * root before the first cycle. Unknown loops start at 0.
   */
  seedSeqByLoop?: Record<string, number>;
  /** Mirror every event elsewhere (e.g. NDJSON to stdout). */
  onEvent?: (e: DeptEvent) => void;
  /** Persist the audit-spine Run (e.g. Postgres). */
  onRun?: (r: RunRecord) => void;
  /** Surface a stream append failure without crashing the cycle. */
  onError?: (err: unknown, e: DeptEvent) => void;
}

/**
 * Build a {@link PersistencePort} backed by an {@link EventStream}. Awaits each loop's
 * `lastSeq` up front so the seq seed survives restart. Returns the port plus a
 * `flush()` that resolves once all in-flight appends settle (useful for the CLI/tests).
 */
export async function createStreamPersistence(
  loopIds: string[],
  opts: StreamPersistenceOptions,
): Promise<PersistencePort & { flush(): Promise<void> }> {
  const seqs = new Map<string, number>();
  for (const loopId of loopIds) {
    const seeded = opts.seedSeqByLoop?.[loopId];
    const next = seeded !== undefined ? seeded : (await opts.stream.lastSeq(loopId)) + 1;
    seqs.set(loopId, Math.max(0, next));
  }

  const inFlight = new Set<Promise<void>>();

  return {
    nextSeq(loopId) {
      const n = seqs.get(loopId) ?? 0;
      seqs.set(loopId, n + 1);
      return n;
    },
    recordEvent(e) {
      opts.onEvent?.(e);
      const p = opts.stream
        .append(e.loopId, e)
        .catch((err: unknown) => opts.onError?.(err, e))
        .finally(() => inFlight.delete(p));
      inFlight.add(p);
    },
    recordRun(r) {
      opts.onRun?.(r);
    },
    async flush() {
      await Promise.allSettled([...inFlight]);
    },
  };
}
