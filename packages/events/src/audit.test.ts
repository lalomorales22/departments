import { describe, expect, it } from 'vitest';
import {
  AUDIT_GENESIS,
  AuditChain,
  buildChain,
  canonicalEvent,
  hashEvent,
  verifyChain,
} from './audit';
import type { DeptEvent } from './index';

function logEvent(seq: number, message: string): DeptEvent {
  return {
    id: `e-${seq}`,
    seq,
    loopId: 'loop-a',
    runId: 'run-1',
    ts: '2026-06-18T00:00:00.000Z',
    kind: 'log',
    payload: { level: 'info', message, source: 'engine' },
  };
}

const stream: DeptEvent[] = [logEvent(0, 'plan'), logEvent(1, 'execute'), logEvent(2, 'evaluate')];

describe('canonicalEvent', () => {
  it('is order-independent over object keys', () => {
    const a = logEvent(0, 'x');
    const b: DeptEvent = { kind: 'log', payload: { source: 'engine', message: 'x', level: 'info' }, ts: a.ts, runId: a.runId, loopId: a.loopId, seq: 0, id: 'e-0' };
    expect(canonicalEvent(a)).toBe(canonicalEvent(b));
  });
});

describe('buildChain + verifyChain', () => {
  it('builds a genesis-rooted chain and verifies clean', () => {
    const chain = buildChain(stream);
    expect(chain).toHaveLength(3);
    expect(chain[0]!.prevHash).toBe(AUDIT_GENESIS);
    expect(chain[1]!.prevHash).toBe(chain[0]!.hash);
    expect(verifyChain(stream, chain).ok).toBe(true);
  });

  it('detects CONTENT tampering (a single altered event)', () => {
    const chain = buildChain(stream);
    const tampered = [...stream];
    tampered[1] = logEvent(1, 'EXECUTE-altered');
    const v = verifyChain(tampered, chain);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it('detects DELETION (a removed event)', () => {
    const chain = buildChain(stream);
    const v = verifyChain([stream[0]!, stream[2]!], chain);
    expect(v.ok).toBe(false);
  });

  it('detects REORDERING', () => {
    const reordered = [stream[1]!, stream[0]!, stream[2]!];
    const v = verifyChain(reordered, buildChain(stream));
    // reordering breaks strict-increasing seq immediately
    expect(v.ok).toBe(false);
  });

  it('rejects non-monotonic seq', () => {
    const bad = [logEvent(0, 'a'), logEvent(0, 'b')];
    expect(verifyChain(bad, buildChain(bad)).ok).toBe(false);
  });

  it('hashEvent chains deterministically', () => {
    const h0 = hashEvent(stream[0]!, AUDIT_GENESIS);
    expect(h0).toBe(buildChain(stream)[0]!.hash);
    expect(h0).toHaveLength(64);
  });
});

describe('AuditChain (stateful, append-only)', () => {
  it('appends links and tracks the running head', () => {
    const chain = new AuditChain();
    expect(chain.head).toBe(AUDIT_GENESIS);
    for (const e of stream) chain.append(e);
    expect(chain.length).toBe(3);
    expect(chain.head).toBe(buildChain(stream)[2]!.hash);
    expect(verifyChain(stream, chain.entries()).ok).toBe(true);
  });

  it('throws on a non-monotonic append (the monotonicity invariant)', () => {
    const chain = new AuditChain();
    chain.append(logEvent(5, 'a'));
    expect(() => chain.append(logEvent(5, 'b'))).toThrow(/non-monotonic/);
    expect(() => chain.append(logEvent(3, 'c'))).toThrow(/non-monotonic/);
  });
});
