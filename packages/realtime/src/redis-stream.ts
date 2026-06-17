/**
 * redis-stream.ts — the PRODUCTION `EventStream` adapter (Redis Streams).
 *
 * Gated on `REDIS_URL`. Like `PgVectorMemoryStore`, it takes an INJECTED minimal
 * client (`RedisLike`) rather than importing `ioredis`/`redis` — so the package has
 * no hard driver dependency, typechecks everywhere, and is unit-tested against a fake
 * client. The composition root constructs the real client (only when Redis is
 * reachable) and hands it in. This adapter is authored + tested here but EXERCISED
 * against real Redis only under `docker compose up -d`.
 *
 * Encoding: each event is one stream entry `XADD loop:{id}:events * e <json>`. Our
 * monotonic per-loop `seq` lives INSIDE the payload (not the Redis `ms-seq` entry id,
 * which we don't fight); `lastSeq` reads the tail entry's payload seq. Idempotency on
 * the stable event `id` is enforced with a companion SET (`SADD` returns 0 if seen).
 */
import type { DeptEvent } from '@departments/events';
import { loopStreamKey } from '@departments/events';
import type { EventStream, Unsubscribe } from './event-stream';

/** One Redis stream entry: `[entryId, ["e", "<json>", ...]]`. */
export type RedisStreamEntry = [string, string[]];

/** The minimal Redis surface this adapter uses (a subset of ioredis's API). */
export interface RedisLike {
  xadd(key: string, id: string, field: string, value: string): Promise<string | null>;
  xrange(key: string, start: string, end: string): Promise<RedisStreamEntry[]>;
  xrevrange(key: string, start: string, end: string, countToken: 'COUNT', count: number): Promise<RedisStreamEntry[]>;
  /** Returns 1 if the member was newly added, 0 if it already existed. */
  sadd(key: string, member: string): Promise<number>;
  quit?(): Promise<unknown>;
}

export interface RedisEventStreamOptions {
  /** Tail poll interval for `subscribe`, ms. Default 250. */
  pollMs?: number;
}

export class RedisEventStream implements EventStream {
  private readonly pollMs: number;

  constructor(
    private readonly redis: RedisLike,
    opts: RedisEventStreamOptions = {},
  ) {
    this.pollMs = opts.pollMs ?? 250;
  }

  private idsKey(loopId: string): string {
    return `${loopStreamKey(loopId)}:ids`;
  }

  async append(loopId: string, event: DeptEvent): Promise<void> {
    // Idempotency: only XADD if this stable id is new for the loop.
    const isNew = await this.redis.sadd(this.idsKey(loopId), event.id);
    if (isNew === 0) return;
    await this.redis.xadd(loopStreamKey(loopId), '*', 'e', JSON.stringify(event));
  }

  async replay(loopId: string, afterSeq: number): Promise<DeptEvent[]> {
    const entries = await this.redis.xrange(loopStreamKey(loopId), '-', '+');
    const out: DeptEvent[] = [];
    for (const ev of decodeEntries(entries)) {
      if (ev.seq > afterSeq) out.push(ev);
    }
    return out;
  }

  async lastSeq(loopId: string): Promise<number> {
    const tail = await this.redis.xrevrange(loopStreamKey(loopId), '+', '-', 'COUNT', 1);
    const decoded = decodeEntries(tail);
    return decoded.length > 0 ? (decoded[decoded.length - 1] as DeptEvent).seq : -1;
  }

  /**
   * Tail the stream by polling `XRANGE (lastEntryId +` after a backlog replay. (A
   * production build would use `XREAD BLOCK`; polling keeps the injected-client
   * surface tiny and is correct — just chattier.) Stops when the handle is called.
   */
  subscribe(loopId: string, fromSeq: number, listener: (e: DeptEvent) => void): Unsubscribe {
    const key = loopStreamKey(loopId);
    let cursor = '-'; // Redis entry-id cursor (NOT our seq)
    let high = fromSeq; // our seq high-water mark, for the same exactly-once guard
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const guarded = (e: DeptEvent) => {
      if (e.seq > high) {
        high = e.seq;
        listener(e);
      }
    };

    const tick = async () => {
      if (stopped) return;
      try {
        const start = cursor === '-' ? '-' : `(${cursor}`; // exclusive after cursor
        const entries = await this.redis.xrange(key, start, '+');
        for (const [entryId, fields] of entries) {
          cursor = entryId;
          const ev = decodeEntry(fields);
          if (ev) guarded(ev);
        }
      } catch {
        /* transient Redis error — retry on the next tick */
      }
      if (!stopped) timer = setTimeout(() => void tick(), this.pollMs);
    };

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  async close(): Promise<void> {
    await this.redis.quit?.();
  }
}

// ─── decode helpers ──────────────────────────────────────────────────────────────

function decodeEntries(entries: RedisStreamEntry[]): DeptEvent[] {
  const out: DeptEvent[] = [];
  for (const [, fields] of entries) {
    const ev = decodeEntry(fields);
    if (ev) out.push(ev);
  }
  return out;
}

/** Pull the `e` field out of a `["e", "<json>"]` field list and parse it. */
function decodeEntry(fields: string[]): DeptEvent | null {
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === 'e') {
      try {
        return JSON.parse(fields[i + 1] as string) as DeptEvent;
      } catch {
        return null;
      }
    }
  }
  return null;
}
