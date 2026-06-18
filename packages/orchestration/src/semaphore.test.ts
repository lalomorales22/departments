import { describe, expect, it } from 'vitest';
import {
  InMemorySemaphore,
  RedisSemaphore,
  createSemaphore,
  type SemaphoreRedisLike,
} from './semaphore.js';

describe('InMemorySemaphore', () => {
  it('caps concurrent slots per org and frees them on release', async () => {
    const s = new InMemorySemaphore({ maxPerOrg: 2 });
    const a = await s.tryAcquire('org');
    const b = await s.tryAcquire('org');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(s.active('org')).toBe(2);
    expect(await s.tryAcquire('org')).toBeNull(); // at cap
    await a!();
    expect(s.active('org')).toBe(1);
    expect(await s.tryAcquire('org')).toBeTruthy(); // a slot freed
  });

  it('blocks acquire when full and hands the freed slot to the FIFO waiter', async () => {
    const s = new InMemorySemaphore({ maxPerOrg: 1 });
    const first = await s.acquire('org');
    let resolved = false;
    const pending = s.acquire('org').then((r) => {
      resolved = true;
      return r;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(s.waiting('org')).toBe(1);
    await first(); // hand the slot to the waiter
    const second = await pending;
    expect(resolved).toBe(true);
    expect(second).toBeTruthy();
  });

  it('isolates orgs and treats double-release as a no-op', async () => {
    const s = new InMemorySemaphore({ maxPerOrg: 1 });
    const a = await s.acquire('org-a');
    expect(await s.tryAcquire('org-b')).toBeTruthy(); // different org unaffected
    await a();
    await a(); // idempotent
    expect(s.active('org-a')).toBe(0);
  });
});

/** A fake Redis counter (INCR/DECR over a Map). */
function fakeRedis(): SemaphoreRedisLike & { store: Map<string, number> } {
  const store = new Map<string, number>();
  return {
    store,
    async incr(k) {
      const n = (store.get(k) ?? 0) + 1;
      store.set(k, n);
      return n;
    },
    async decr(k) {
      const n = (store.get(k) ?? 0) - 1;
      store.set(k, n);
      return n;
    },
  };
}

describe('RedisSemaphore (fake client)', () => {
  it('acquires up to the cap via INCR and refuses (DECR back) over it', async () => {
    const client = fakeRedis();
    const s = new RedisSemaphore({ client, maxPerOrg: 1 });
    const a = await s.tryAcquire('org');
    expect(a).toBeTruthy();
    expect(client.store.get('dept:sem:org')).toBe(1);
    expect(await s.tryAcquire('org')).toBeNull(); // over cap → rolled back
    expect(client.store.get('dept:sem:org')).toBe(1); // DECR undid the overflow INCR
    await a!();
    expect(client.store.get('dept:sem:org')).toBe(0);
  });

  it('blocking acquire polls until a slot frees', async () => {
    const client = fakeRedis();
    let firstRelease: (() => void | Promise<void>) | null = null;
    let freed = false;
    const s = new RedisSemaphore({
      client,
      maxPerOrg: 1,
      // On the first poll, free the held slot so the next tryAcquire succeeds.
      sleep: async () => {
        if (!freed && firstRelease) {
          freed = true;
          await firstRelease();
        }
      },
    });
    firstRelease = await s.acquire('org'); // holds the only slot
    const second = await s.acquire('org'); // null → sleep frees → retry succeeds
    expect(second).toBeTruthy();
  });
});

describe('createSemaphore (gate-and-fallback)', () => {
  it('returns Redis only when both a url and a client are present, else in-memory', () => {
    const client = fakeRedis();
    expect(createSemaphore()).toBeInstanceOf(InMemorySemaphore);
    expect(createSemaphore({ redisUrl: 'redis://x' })).toBeInstanceOf(InMemorySemaphore);
    expect(createSemaphore({ redisClient: client })).toBeInstanceOf(InMemorySemaphore);
    expect(createSemaphore({ redisUrl: 'redis://x', redisClient: client })).toBeInstanceOf(RedisSemaphore);
  });
});
