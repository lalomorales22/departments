import { describe, expect, it } from 'vitest';
import type { DeptEvent } from '@departments/events';
import { BoundedSet, emptyResumeState, ingest, resumeQuery } from './resume';

function log(seq: number, id = `log-${seq}`): DeptEvent {
  return { id, seq, loopId: 'L', ts: '2026-06-17T00:00:00Z', kind: 'log', payload: { level: 'info', message: `m${seq}` } };
}
function status(seq: number, id = `st-${seq}`): DeptEvent {
  return {
    id,
    seq,
    loopId: 'L',
    ts: '2026-06-17T00:00:00Z',
    kind: 'status',
    payload: { scope: 'loop', targetId: 'L', loopStatus: 'running', phase: 'plan' },
  };
}

/** Fold a list of events through ingest, returning the final state. */
function foldAll(events: DeptEvent[]) {
  let s = emptyResumeState();
  const results = events.map((e) => {
    const r = ingest(s, e);
    s = r.state;
    return r.result;
  });
  return { state: s, results };
}

describe('ingest — the resume/dedupe core', () => {
  it('appends new events in seq order and advances lastSeq', () => {
    const { state } = foldAll([log(0), log(1), log(2)]);
    expect(state.events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(state.lastSeq).toBe(2);
  });

  it('starts lastSeq at -1 so seq 0 is the first applied event', () => {
    expect(emptyResumeState().lastSeq).toBe(-1);
    const { state } = foldAll([log(0)]);
    expect(state.lastSeq).toBe(0);
  });

  it('rejects a duplicate non-settle event (same id) — no duplicate line', () => {
    const { state, results } = foldAll([log(0, 'dup'), log(5, 'dup')]);
    expect(state.events).toHaveLength(1);
    expect(results[1]).toEqual({ accepted: false, appended: false });
    // lastSeq is NOT advanced by a rejected duplicate.
    expect(state.lastSeq).toBe(0);
  });

  it('re-affirms a duplicate ALWAYS-SETTLE event: advances lastSeq, no duplicate line', () => {
    const { state, results } = foldAll([status(3, 'dup'), status(7, 'dup')]);
    expect(state.events).toHaveLength(1); // no duplicate status line
    expect(results[1]).toEqual({ accepted: true, appended: false });
    expect(state.lastSeq).toBe(7); // settled forward
  });

  it('keeps events sorted when an out-of-order (overlapping replay) event arrives', () => {
    const { state } = foldAll([log(0), log(2), log(1)]);
    expect(state.events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(state.lastSeq).toBe(2);
  });

  it('models a reconnect: replay overlap is deduped, only genuinely-new events append', () => {
    // First connection delivers 0..3.
    let s = emptyResumeState();
    for (const e of [log(0), log(1), log(2), log(3)]) s = ingest(s, e).state;
    expect(s.lastSeq).toBe(3);
    // Reconnect replays from an earlier cursor (2,3 again) then new (4,5).
    const replay = [log(2), log(3), log(4), log(5)];
    let appended = 0;
    for (const e of replay) {
      const r = ingest(s, e);
      s = r.state;
      if (r.result.appended) appended += 1;
    }
    expect(appended).toBe(2); // only 4 and 5 are new
    expect(s.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(s.lastSeq).toBe(5);
  });
});

describe('resumeQuery', () => {
  it('passes a real cursor through and floors invalid/empty to -1', () => {
    expect(resumeQuery(7)).toBe(7);
    expect(resumeQuery(0)).toBe(0);
    expect(resumeQuery(-1)).toBe(-1);
    expect(resumeQuery(Number.NaN)).toBe(-1);
  });
});

describe('BoundedSet', () => {
  it('dedupes within the window', () => {
    const s = new BoundedSet(3);
    s.add('a');
    s.add('a');
    expect(s.has('a')).toBe(true);
    expect(s.size).toBe(1);
  });

  it('evicts the oldest id past the cap (insertion order)', () => {
    const s = new BoundedSet(2);
    s.add('a');
    s.add('b');
    s.add('c'); // evicts 'a'
    expect(s.has('a')).toBe(false);
    expect(s.has('b')).toBe(true);
    expect(s.has('c')).toBe(true);
    expect(s.size).toBe(2);
  });
});
