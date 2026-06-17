import { describe, expect, it } from 'vitest';
import { backoffDelay, ReconnectController } from './reconnect';

describe('backoffDelay', () => {
  it('grows exponentially and caps at maxMs (no jitter)', () => {
    const opts = { baseMs: 500, factor: 2, maxMs: 4000, jitter: 0 };
    const noJitter = () => 1; // scale = 1 - 0*rand = 1
    expect(backoffDelay(1, opts, noJitter)).toBe(500);
    expect(backoffDelay(2, opts, noJitter)).toBe(1000);
    expect(backoffDelay(3, opts, noJitter)).toBe(2000);
    expect(backoffDelay(4, opts, noJitter)).toBe(4000);
    expect(backoffDelay(5, opts, noJitter)).toBe(4000); // capped
  });

  it('applies jitter within [raw*(1-jitter), raw]', () => {
    const opts = { baseMs: 1000, factor: 2, maxMs: 10_000, jitter: 0.25 };
    // rand=0 → scale 1 → full; rand=1 → scale 0.75 → floor.
    expect(backoffDelay(1, opts, () => 0)).toBe(1000);
    expect(backoffDelay(1, opts, () => 1)).toBe(750);
  });
});

describe('ReconnectController', () => {
  it('walks idle → connecting → live and resets the attempt counter on open', () => {
    const c = new ReconnectController();
    expect(c.state).toBe('idle');
    c.connecting();
    expect(c.state).toBe('connecting');
    c.onError(); // attempt 1
    expect(c.attempt).toBe(1);
    c.connecting();
    expect(c.state).toBe('reconnecting'); // attempt>0 → reconnecting
    c.onOpen();
    expect(c.state).toBe('live');
    expect(c.attempt).toBe(0);
  });

  it('retries with growing backoff, then gives up at maxAttempts', () => {
    const c = new ReconnectController({ baseMs: 100, factor: 2, jitter: 0, maxAttempts: 2 }, () => 0, () => 1);
    const a = c.onError();
    expect(a).toEqual({ retry: true, delayMs: 100 });
    const b = c.onError();
    expect(b).toEqual({ retry: true, delayMs: 200 });
    const giveUp = c.onError();
    expect(giveUp.retry).toBe(false);
    expect(c.state).toBe('error');
  });

  it('flips live → stale when the stream goes quiet, and back to live on activity', () => {
    let now = 0;
    const c = new ReconnectController({ staleAfterMs: 1000 }, () => now);
    c.connecting();
    c.onOpen(); // lastActivity = 0
    now = 500;
    expect(c.checkStale()).toBe(false); // within window
    now = 2000;
    expect(c.checkStale()).toBe(true);
    expect(c.state).toBe('stale');
    c.onActivity(); // a heartbeat or event arrives
    expect(c.state).toBe('live');
  });
});
