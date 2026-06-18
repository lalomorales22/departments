/**
 * semaphore.ts — the per-org CONCURRENCY SEMAPHORE (a runaway guard).
 *
 * Autonomy scales in Phase 4 (CEO → child trees, scheduled cadence), so the number
 * of sessions executing AT ONCE for an org must be capped or a misbehaving tree can
 * stampede the provider and the budget. The engine acquires a slot before each model
 * session and releases it after, so concurrent loops share a bounded pool per org.
 *
 * Two adapters ship behind one interface (the proven Fake/Redis pattern used by the
 * realtime `EventStream`):
 *   - {@link InMemorySemaphore} — a FIFO counting semaphore; the local cockpit's
 *     default, works with zero infra.
 *   - {@link RedisSemaphore} — gated on `REDIS_URL` + an INJECTED minimal client (no
 *     `ioredis` import), so a horizontally-scaled gateway/worker fleet shares one
 *     pool. Authored + fake-tested here; exercised only under Docker.
 */

/** Releasing a slot is idempotent; may be sync (in-memory) or async (Redis DECR). */
export type SemaphoreRelease = () => void | Promise<void>;

export interface ConcurrencySemaphore {
  /** Acquire a slot for `orgId`, resolving when one is free (FIFO when contended). */
  acquire(orgId: string): Promise<SemaphoreRelease>;
  /** Acquire without waiting; resolves to `null` when the org is already at its cap. */
  tryAcquire(orgId: string): Promise<SemaphoreRelease | null>;
}

// ── In-memory (default) ───────────────────────────────────────────────────────

export interface InMemorySemaphoreOptions {
  /** Max sessions executing at once per org. Default 4. */
  maxPerOrg?: number;
}

export class InMemorySemaphore implements ConcurrencySemaphore {
  private readonly max: number;
  private readonly counts = new Map<string, number>();
  private readonly queues = new Map<string, Array<(r: SemaphoreRelease) => void>>();

  constructor(opts: InMemorySemaphoreOptions = {}) {
    this.max = Math.max(1, opts.maxPerOrg ?? 4);
  }

  /** Slots currently held for `orgId` (test/observability helper). */
  active(orgId: string): number {
    return this.counts.get(orgId) ?? 0;
  }

  /** Confirmations queued waiting for a slot for `orgId`. */
  waiting(orgId: string): number {
    return this.queues.get(orgId)?.length ?? 0;
  }

  async tryAcquire(orgId: string): Promise<SemaphoreRelease | null> {
    if (this.active(orgId) >= this.max) return null;
    this.counts.set(orgId, this.active(orgId) + 1);
    return this.makeRelease(orgId);
  }

  async acquire(orgId: string): Promise<SemaphoreRelease> {
    const slot = await this.tryAcquire(orgId);
    if (slot) return slot;
    return new Promise<SemaphoreRelease>((resolve) => {
      const q = this.queues.get(orgId) ?? [];
      q.push(resolve);
      this.queues.set(orgId, q);
    });
  }

  private makeRelease(orgId: string): SemaphoreRelease {
    let released = false;
    return () => {
      if (released) return; // idempotent — double-release is a no-op
      released = true;
      const q = this.queues.get(orgId);
      if (q && q.length > 0) {
        // Hand the slot straight to the next waiter — the count is unchanged.
        const next = q.shift();
        next?.(this.makeRelease(orgId));
      } else {
        this.counts.set(orgId, Math.max(0, this.active(orgId) - 1));
      }
    };
  }
}

// ── Redis (gated) ─────────────────────────────────────────────────────────────

/** The minimal Redis surface the semaphore needs — injected, never imported. */
export interface SemaphoreRedisLike {
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
}

export interface RedisSemaphoreOptions {
  client: SemaphoreRedisLike;
  /** Max sessions executing at once per org. Default 4. */
  maxPerOrg?: number;
  /** Key prefix; the org id is appended. Default `dept:sem:`. */
  keyPrefix?: string;
  /** Poll interval while blocked in {@link acquire}. Injected for tests. Default 200ms. */
  sleep?: (ms: number) => Promise<void>;
  /** Poll cadence (ms) for the blocking acquire. Default 200. */
  pollMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class RedisSemaphore implements ConcurrencySemaphore {
  private readonly client: SemaphoreRedisLike;
  private readonly max: number;
  private readonly prefix: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollMs: number;

  constructor(opts: RedisSemaphoreOptions) {
    this.client = opts.client;
    this.max = Math.max(1, opts.maxPerOrg ?? 4);
    this.prefix = opts.keyPrefix ?? 'dept:sem:';
    this.sleep = opts.sleep ?? defaultSleep;
    this.pollMs = opts.pollMs ?? 200;
  }

  private key(orgId: string): string {
    return `${this.prefix}${orgId}`;
  }

  async tryAcquire(orgId: string): Promise<SemaphoreRelease | null> {
    const key = this.key(orgId);
    const n = await this.client.incr(key);
    if (n > this.max) {
      // Over the cap — give the slot back and report contention.
      await this.client.decr(key);
      return null;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await this.client.decr(key);
    };
  }

  async acquire(orgId: string): Promise<SemaphoreRelease> {
    // Poll until a slot frees. The injected sleep keeps this testable + the cap holds
    // even across replicas (the counter is the shared source of truth).
    for (;;) {
      const slot = await this.tryAcquire(orgId);
      if (slot) return slot;
      await this.sleep(this.pollMs);
    }
  }
}

// ── Factory (gate-and-fallback) ────────────────────────────────────────────────

export interface CreateSemaphoreOptions {
  redisUrl?: string;
  /** Injected Redis client; the package never imports a driver. */
  redisClient?: SemaphoreRedisLike;
  maxPerOrg?: number;
}

/**
 * Pick the semaphore adapter: {@link RedisSemaphore} only when BOTH a `redisUrl` and
 * an injected client are present (mirrors `createEventStream`), else the zero-infra
 * {@link InMemorySemaphore}.
 */
export function createSemaphore(opts: CreateSemaphoreOptions = {}): ConcurrencySemaphore {
  if (opts.redisUrl && opts.redisClient) {
    return new RedisSemaphore({ client: opts.redisClient, maxPerOrg: opts.maxPerOrg });
  }
  return new InMemorySemaphore({ maxPerOrg: opts.maxPerOrg });
}
