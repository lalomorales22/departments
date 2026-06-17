/**
 * event-stream.ts — the realtime spine's storage/transport boundary.
 *
 * `EventStream` abstracts the Redis Streams operations the architecture calls for
 * (XADD / XRANGE-after-cursor / XREAD-BLOCK tail) behind ONE port, so the engine,
 * the SSE route, and the WS gateway all program against it. Two adapters ship from
 * day one — `InMemoryEventStream` (works with zero infra) and `RedisEventStream`
 * (gated on `REDIS_URL`) — mirroring `FakeCmaRuntime`/`CmaRuntime` and
 * `InMemoryMemoryStore`/`PgVectorMemoryStore`.
 *
 * The load-bearing method is {@link EventStream.lastSeq}: it makes the per-loop `seq`
 * allocator PERSISTENT. The engine seeds its monotonic counter from `lastSeq(loopId)`,
 * so `(loopId, seq)` stays monotonic across process restarts — the structural
 * precondition for resume-after-restart.
 */
import type { DeptEvent } from '@departments/events';
import { loopStreamKey } from '@departments/events';

/** Unsubscribe handle returned by {@link EventStream.subscribe}. */
export type Unsubscribe = () => void;

export interface EventStream {
  /**
   * Append an already-seq-stamped event to the loop's append-only log. Idempotent on
   * `event.id` — re-appending a seen id is a no-op (so a replayed engine tick can't
   * double-store). Returns once durably appended (in-mem: synchronously).
   */
  append(loopId: string, event: DeptEvent): Promise<void>;

  /** All stored events with `seq` strictly greater than `afterSeq`, in `seq` order. */
  replay(loopId: string, afterSeq: number): Promise<DeptEvent[]>;

  /**
   * Deliver every event with `seq > fromSeq` — first the current backlog, then the
   * live tail — to `listener`, in `seq` order with no duplicates. Returns an
   * unsubscribe handle. The subscription tracks its own high-water mark so an append
   * racing the backlog scan is delivered exactly once.
   */
  subscribe(loopId: string, fromSeq: number, listener: (e: DeptEvent) => void): Unsubscribe;

  /** Highest `seq` stored for the loop, or -1 if none — the persistent cursor source. */
  lastSeq(loopId: string): Promise<number>;

  /** Best-effort cleanup (close clients / timers). In-mem is a no-op. */
  close?(): Promise<void>;
}

// ─── In-memory adapter ──────────────────────────────────────────────────────────

interface LoopLog {
  /** Ascending-by-seq, deduped by id. */
  events: DeptEvent[];
  ids: Set<string>;
  /** Highest seq ever appended (survives trimming of `events`). */
  maxSeq: number;
  listeners: Set<(e: DeptEvent) => void>;
}

export interface InMemoryEventStreamOptions {
  /**
   * Keep at most this many recent events per loop in `events` (the resume window).
   * `lastSeq`/`maxSeq` are tracked independently so trimming never corrupts the
   * cursor. Defaults to 5000 — generous for a dev session, bounded for a long-lived
   * server process.
   */
  retain?: number;
}

/**
 * A process-local `EventStream` backed by a per-loop array + a listener set. Fully
 * unit-testable; it is also the real adapter the cockpit uses when no `REDIS_URL` is
 * configured (the proven `InMemory*` pattern). Single-threaded JS guarantees the
 * subscribe/append interleaving below is race-free.
 */
export class InMemoryEventStream implements EventStream {
  private readonly logs = new Map<string, LoopLog>();
  private readonly retain: number;

  constructor(opts: InMemoryEventStreamOptions = {}) {
    this.retain = Math.max(1, opts.retain ?? 5000);
  }

  private log(loopId: string): LoopLog {
    let l = this.logs.get(loopId);
    if (!l) {
      l = { events: [], ids: new Set(), maxSeq: -1, listeners: new Set() };
      this.logs.set(loopId, l);
    }
    return l;
  }

  async append(loopId: string, event: DeptEvent): Promise<void> {
    const l = this.log(loopId);
    if (l.ids.has(event.id)) return; // idempotent on id
    l.ids.add(event.id);
    l.events.push(event);
    if (event.seq > l.maxSeq) l.maxSeq = event.seq;
    if (l.events.length > this.retain) {
      const dropped = l.events.shift();
      if (dropped) l.ids.delete(dropped.id);
    }
    // Fan out to live subscribers. A throwing listener must not stall the others.
    for (const fn of l.listeners) {
      try {
        fn(event);
      } catch {
        /* isolate subscriber failures */
      }
    }
  }

  async replay(loopId: string, afterSeq: number): Promise<DeptEvent[]> {
    const l = this.logs.get(loopId);
    if (!l) return [];
    return l.events.filter((e) => e.seq > afterSeq);
  }

  subscribe(loopId: string, fromSeq: number, listener: (e: DeptEvent) => void): Unsubscribe {
    const l = this.log(loopId);
    let high = fromSeq;
    // Guarded delivery: forward only strictly-increasing seqs, so an append that
    // arrives between the backlog scan and listener registration is delivered once.
    const guarded = (e: DeptEvent) => {
      if (e.seq > high) {
        high = e.seq;
        listener(e);
      }
    };
    l.listeners.add(guarded);
    // Drain the current backlog (already stored) through the same guard.
    for (const e of l.events) guarded(e);
    return () => {
      l.listeners.delete(guarded);
    };
  }

  async lastSeq(loopId: string): Promise<number> {
    return this.logs.get(loopId)?.maxSeq ?? -1;
  }

  /** Test/dev helper: forget a loop entirely (NOT part of the port). */
  reset(loopId: string): void {
    this.logs.delete(loopId);
  }
}
