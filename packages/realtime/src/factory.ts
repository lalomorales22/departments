/**
 * factory.ts — env-gated selection of the `EventStream` adapter.
 *
 * Mirrors the project's gating convention (`local-driver` for the runtime,
 * `PgVectorMemoryStore` for memory): `REDIS_URL` present → Redis; absent →
 * in-memory. The Redis client is constructed by the CALLER and injected, so this
 * package never imports a driver. `createEventStream` therefore stays in-memory
 * unless a `redisClient` is supplied alongside a `REDIS_URL`.
 */
import { InMemoryEventStream, type EventStream } from './event-stream';
import { RedisEventStream, type RedisLike } from './redis-stream';

export interface CreateEventStreamOptions {
  /** Typically `process.env.REDIS_URL`. Presence selects the Redis adapter. */
  redisUrl?: string | undefined;
  /** A constructed Redis client (injected — this package imports no driver). */
  redisClient?: RedisLike | undefined;
  /** Retain window for the in-memory adapter. */
  retain?: number;
}

/**
 * Returns the Redis-backed stream when BOTH a `redisUrl` and an injected
 * `redisClient` are present; otherwise the in-memory stream. Requiring the client to
 * be injected keeps "no driver dependency" honest — a `redisUrl` with no client
 * (e.g. this machine, no Docker) transparently falls back to in-memory.
 */
export function createEventStream(opts: CreateEventStreamOptions = {}): EventStream {
  if (opts.redisUrl && opts.redisClient) {
    return new RedisEventStream(opts.redisClient);
  }
  return new InMemoryEventStream({ retain: opts.retain });
}
