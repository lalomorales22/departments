import { describe, expect, it } from 'vitest';
import { InMemoryEventStream } from '@departments/realtime';
import type { DeptEvent } from '@departments/events';
import { createStreamPersistence } from './stream-persistence.js';

function ev(seq: number, loopId = 'L', id = `e-${seq}`): DeptEvent {
  return { id, seq, loopId, ts: '2026-06-17T00:00:00Z', kind: 'log', payload: { level: 'info', message: `m${seq}` } };
}

describe('createStreamPersistence', () => {
  it('seeds the seq counter from EventStream.lastSeq + 1 (survives restart)', async () => {
    const stream = new InMemoryEventStream();
    // Pretend a prior process already wrote seq 0..4.
    for (let i = 0; i < 5; i++) await stream.append('L', ev(i));

    const p = await createStreamPersistence(['L'], { stream });
    expect(p.nextSeq('L')).toBe(5); // continues monotonically, not reset to 0
    expect(p.nextSeq('L')).toBe(6);
  });

  it('starts unknown loops at 0', async () => {
    const p = await createStreamPersistence(['fresh'], { stream: new InMemoryEventStream() });
    expect(p.nextSeq('fresh')).toBe(0);
  });

  it('tees recordEvent into the stream and onEvent, settling on flush', async () => {
    const stream = new InMemoryEventStream();
    const ndjson: DeptEvent[] = [];
    const p = await createStreamPersistence(['L'], { stream, onEvent: (e) => ndjson.push(e) });

    p.recordEvent(ev(0));
    p.recordEvent(ev(1));
    await p.flush();

    expect(ndjson.map((e) => e.seq)).toEqual([0, 1]);
    expect((await stream.replay('L', -1)).map((e) => e.seq)).toEqual([0, 1]);
  });

  it('reports a stream append failure via onError without throwing', async () => {
    const failing = new InMemoryEventStream();
    failing.append = () => Promise.reject(new Error('redis down'));
    const errors: unknown[] = [];
    const p = await createStreamPersistence(['L'], { stream: failing, onError: (e) => errors.push(e) });
    p.recordEvent(ev(0));
    await p.flush();
    expect(errors).toHaveLength(1);
  });
});
