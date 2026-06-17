/**
 * @departments/realtime — the reconnect-safe realtime spine.
 *
 * CMA-SSE → normalizer (in `agent-runtime`) → engine seq-stamp → **EventStream**
 * (Redis Streams / in-memory) → transport (SSE today, WS gateway in prod) → client.
 * This package owns the transport-agnostic middle: the stream storage port + adapters,
 * the resume-by-seq / dedupe-by-id / always-settle core, the WS topic router, and the
 * reconnection policy. The frozen `Event` contract lives in `@departments/events`;
 * this package implements transport against it without ever changing it.
 */
export type { EventStream, Unsubscribe, InMemoryEventStreamOptions } from './event-stream';
export { InMemoryEventStream } from './event-stream';
export type { RedisLike, RedisStreamEntry, RedisEventStreamOptions } from './redis-stream';
export { RedisEventStream } from './redis-stream';
export { createEventStream, type CreateEventStreamOptions } from './factory';
export {
  BoundedSet,
  ingest,
  emptyResumeState,
  resumeQuery,
  type ResumeState,
  type IngestResult,
} from './resume';
export { topicsFor } from './topics';
export {
  backoffDelay,
  ReconnectController,
  type BackoffOptions,
  type ConnectionState,
} from './reconnect';
