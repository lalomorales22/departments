import { describe, expect, it } from 'vitest';
import type { DeptEvent } from '@departments/events';
import { InMemoryEventStream } from './event-stream';

function ev(seq: number, id = `e-${seq}`): DeptEvent {
  return { id, seq, loopId: 'L', ts: '2026-06-17T00:00:00Z', kind: 'log', payload: { level: 'info', message: `m${seq}` } };
}

describe('InMemoryEventStream', () => {
  it('appends and replays events strictly after a cursor', async () => {
    const s = new InMemoryEventStream();
    for (let i = 0; i < 5; i++) await s.append('L', ev(i));
    expect((await s.replay('L', -1)).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect((await s.replay('L', 2)).map((e) => e.seq)).toEqual([3, 4]);
    expect(await s.replay('missing', -1)).toEqual([]);
  });

  it('lastSeq reports the highest appended seq (-1 when empty)', async () => {
    const s = new InMemoryEventStream();
    expect(await s.lastSeq('L')).toBe(-1);
    await s.append('L', ev(0));
    await s.append('L', ev(7));
    expect(await s.lastSeq('L')).toBe(7);
  });

  it('is idempotent on event id (a replayed tick cannot double-store)', async () => {
    const s = new InMemoryEventStream();
    await s.append('L', ev(0, 'same'));
    await s.append('L', ev(1, 'same'));
    expect((await s.replay('L', -1)).map((e) => e.id)).toEqual(['same']);
  });

  it('subscribe delivers the backlog then the live tail, in order, exactly once', async () => {
    const s = new InMemoryEventStream();
    await s.append('L', ev(0));
    await s.append('L', ev(1));
    const seen: number[] = [];
    const unsub = s.subscribe('L', -1, (e) => seen.push(e.seq));
    expect(seen).toEqual([0, 1]); // backlog
    await s.append('L', ev(2)); // live
    expect(seen).toEqual([0, 1, 2]);
    unsub();
    await s.append('L', ev(3)); // after unsubscribe — not delivered
    expect(seen).toEqual([0, 1, 2]);
  });

  it('subscribe honors fromSeq (resume): only events after the cursor are delivered', async () => {
    const s = new InMemoryEventStream();
    for (let i = 0; i < 4; i++) await s.append('L', ev(i));
    const seen: number[] = [];
    s.subscribe('L', 1, (e) => seen.push(e.seq));
    expect(seen).toEqual([2, 3]);
  });

  it('a throwing subscriber does not stall other subscribers', async () => {
    const s = new InMemoryEventStream();
    const ok: number[] = [];
    s.subscribe('L', -1, () => {
      throw new Error('boom');
    });
    s.subscribe('L', -1, (e) => ok.push(e.seq));
    await s.append('L', ev(0));
    expect(ok).toEqual([0]);
  });

  it('retains a bounded window but never corrupts lastSeq', async () => {
    const s = new InMemoryEventStream({ retain: 2 });
    for (let i = 0; i < 5; i++) await s.append('L', ev(i));
    // Only the last 2 remain in the replay window...
    expect((await s.replay('L', -1)).map((e) => e.seq)).toEqual([3, 4]);
    // ...but the cursor is still authoritative across the trim.
    expect(await s.lastSeq('L')).toBe(4);
  });
});
