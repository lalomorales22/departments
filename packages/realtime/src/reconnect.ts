/**
 * reconnect.ts — the transport-agnostic reconnection policy.
 *
 * Pure, time-injectable logic shared by the browser store (SSE) and any future WS
 * client: an exponential backoff schedule with jitter and a small connection state
 * machine. The actual socket/EventSource lives in the consumer; this module decides
 * "how long until the next attempt" and "what state are we in", so the timing policy
 * is unit-tested once rather than reimplemented per transport.
 */

export type ConnectionState =
  | 'idle' // never connected / explicitly stopped
  | 'connecting' // first attempt in flight
  | 'live' // connected, events flowing
  | 'reconnecting' // dropped, backing off before the next attempt
  | 'stale' // connected but no event/heartbeat within the stale window
  | 'error'; // gave up (max attempts) or fatal

export interface BackoffOptions {
  /** First retry delay. Default 500ms. */
  baseMs?: number;
  /** Ceiling for a single delay. Default 15000ms. */
  maxMs?: number;
  /** Growth factor per attempt. Default 2. */
  factor?: number;
  /** Multiplicative jitter in [1-jitter, 1]. Default 0.25. Pass a `rand` for tests. */
  jitter?: number;
}

/**
 * Delay before retry `attempt` (1-based): `base * factor^(attempt-1)`, capped at
 * `maxMs`, then scaled by jitter in `[1-jitter, 1]`. Jitter spreads a thundering herd
 * of reconnects; pass `rand` (default `Math.random`) to make it deterministic in tests.
 */
export function backoffDelay(attempt: number, opts: BackoffOptions = {}, rand: () => number = Math.random): number {
  const base = opts.baseMs ?? 500;
  const max = opts.maxMs ?? 15_000;
  const factor = opts.factor ?? 2;
  const jitter = clamp01(opts.jitter ?? 0.25);
  const n = Math.max(1, Math.floor(attempt));
  const raw = Math.min(max, base * Math.pow(factor, n - 1));
  const scale = 1 - jitter * rand();
  return Math.round(raw * scale);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Tracks connection lifecycle + heartbeat liveness with an injectable clock. The
 * consumer calls `onOpen/onEvent/onError/markAttempt` and reads `state`/`nextDelay`;
 * `checkStale(now)` is polled on a UI timer to flip `live → stale` when the stream
 * goes quiet (no event AND no heartbeat) past `staleAfterMs`.
 */
export class ReconnectController {
  state: ConnectionState = 'idle';
  attempt = 0;
  private lastActivity = 0;

  constructor(
    private readonly opts: BackoffOptions & { staleAfterMs?: number; maxAttempts?: number } = {},
    private readonly now: () => number = () => Date.now(),
    private readonly rand: () => number = Math.random,
  ) {}

  /** Connection attempt started. */
  connecting(): void {
    this.state = this.attempt === 0 ? 'connecting' : 'reconnecting';
  }

  /** Socket opened. */
  onOpen(): void {
    this.state = 'live';
    this.attempt = 0;
    this.lastActivity = this.now();
  }

  /** Any event or heartbeat arrived — clears staleness, keeps us live. */
  onActivity(): void {
    this.lastActivity = this.now();
    if (this.state === 'stale') this.state = 'live';
  }

  /** Socket dropped — decide whether to retry, and how long to wait. */
  onError(): { retry: boolean; delayMs: number } {
    this.attempt += 1;
    const max = this.opts.maxAttempts ?? Number.POSITIVE_INFINITY;
    if (this.attempt > max) {
      this.state = 'error';
      return { retry: false, delayMs: 0 };
    }
    this.state = 'reconnecting';
    return { retry: true, delayMs: backoffDelay(this.attempt, this.opts, this.rand) };
  }

  /** Poll from a UI timer: flip to `stale` if the stream has gone quiet while live. */
  checkStale(): boolean {
    const staleAfter = this.opts.staleAfterMs ?? 20_000;
    if (this.state === 'live' && this.now() - this.lastActivity > staleAfter) {
      this.state = 'stale';
      return true;
    }
    return false;
  }

  /** Explicit stop (unmount / manual disconnect). */
  stop(): void {
    this.state = 'idle';
    this.attempt = 0;
  }
}
