import { describe, expect, it } from 'vitest';
import type { DeptEvent } from '@departments/events';
import { RedisEventStream, type RedisLike, type RedisStreamEntry } from './redis-stream';

/** A tiny in-memory fake of the Redis Streams surface this adapter uses. */
class FakeRedis implements RedisLike {
  private streams = new Map<string, RedisStreamEntry[]>();
  private sets = new Map<string, Set<string>>();
  private counter = 0;

  async xadd(key: string, _id: string, field: string, value: string): Promise<string> {
    const id = `${++this.counter}-0`;
    const arr = this.streams.get(key) ?? [];
    arr.push([id, [field, value]]);
    this.streams.set(key, arr);
    return id;
  }
  async xrange(key: string, start: string, end: string): Promise<RedisStreamEntry[]> {
    const arr = this.streams.get(key) ?? [];
    const exclusiveAfter = start.startsWith('(') ? start.slice(1) : null;
    return arr.filter(([id]) => {
      if (exclusiveAfter !== null) return cmpId(id, exclusiveAfter) > 0;
      if (start !== '-' && cmpId(id, start) < 0) return false;
      if (end !== '+' && cmpId(id, end) > 0) return false;
      return true;
    });
  }
  async xrevrange(key: string, _end: string, _start: string, _t: 'COUNT', count: number): Promise<RedisStreamEntry[]> {
    const arr = (this.streams.get(key) ?? []).slice().reverse();
    return arr.slice(0, count);
  }
  async sadd(key: string, member: string): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    const had = set.has(member);
    set.add(member);
    this.sets.set(key, set);
    return had ? 0 : 1;
  }
}

function cmpId(a: string, b: string): number {
  const [am, as] = a.split('-').map(Number);
  const [bm, bs] = b.split('-').map(Number);
  return am !== bm ? (am as number) - (bm as number) : (as as number) - (bs as number);
}

function ev(seq: number, id = `e-${seq}`): DeptEvent {
  return { id, seq, loopId: 'L', ts: '2026-06-17T00:00:00Z', kind: 'log', payload: { level: 'info', message: `m${seq}` } };
}

describe('RedisEventStream (against a fake client)', () => {
  it('appends and replays after a seq cursor', async () => {
    const s = new RedisEventStream(new FakeRedis());
    for (let i = 0; i < 4; i++) await s.append('L', ev(i));
    expect((await s.replay('L', -1)).map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect((await s.replay('L', 1)).map((e) => e.seq)).toEqual([2, 3]);
  });

  it('is idempotent on event id (SADD guard)', async () => {
    const s = new RedisEventStream(new FakeRedis());
    await s.append('L', ev(0, 'same'));
    await s.append('L', ev(9, 'same'));
    expect((await s.replay('L', -1)).map((e) => e.id)).toEqual(['same']);
  });

  it('lastSeq reads the tail payload seq (-1 when empty)', async () => {
    const s = new RedisEventStream(new FakeRedis());
    expect(await s.lastSeq('L')).toBe(-1);
    await s.append('L', ev(0));
    await s.append('L', ev(5));
    expect(await s.lastSeq('L')).toBe(5);
  });

  it('subscribe tails newly appended events after a poll', async () => {
    const s = new RedisEventStream(new FakeRedis(), { pollMs: 5 });
    await s.append('L', ev(0));
    const seen: number[] = [];
    const unsub = s.subscribe('L', -1, (e) => seen.push(e.seq));
    await delay(15); // backlog
    await s.append('L', ev(1));
    await delay(15); // tail poll picks it up
    unsub();
    expect(seen).toEqual([0, 1]);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
