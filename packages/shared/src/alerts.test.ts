import { describe, expect, it } from 'vitest';
import {
  AlertBus,
  RefusalStormDetector,
  StreamHealthMonitor,
  makeAlert,
  type Alert,
} from './alerts';

describe('makeAlert', () => {
  it('builds an alert with a default dedupe key', () => {
    const a = makeAlert('budget_breach', 'critical', 'hard cap', { loopId: 'loop-a' });
    expect(a.key).toBe('budget_breach:loop-a');
    expect(a.severity).toBe('critical');
  });
});

describe('AlertBus', () => {
  it('fans out to sinks and keeps a recent feed', () => {
    const bus = new AlertBus();
    const seen: Alert[] = [];
    bus.subscribe((a) => seen.push(a));
    bus.emit(makeAlert('no_progress_pause', 'warning', 'stalled', { loopId: 'l1' }));
    expect(seen).toHaveLength(1);
    expect(bus.feed()).toHaveLength(1);
  });

  it('dedupes the same key within the cooldown window', () => {
    let now = 0;
    const bus = new AlertBus({ cooldownMs: 1000, nowMs: () => now });
    const a = makeAlert('budget_breach', 'critical', 'cap', { loopId: 'l1' });
    expect(bus.emit(a)).toBe(true);
    now = 500;
    expect(bus.emit(a)).toBe(false); // within cooldown
    now = 1600;
    expect(bus.emit(a)).toBe(true); // window elapsed
  });

  it('different keys are not deduped', () => {
    const bus = new AlertBus({ cooldownMs: 1000, nowMs: () => 0 });
    expect(bus.emit(makeAlert('budget_breach', 'critical', 'x', { loopId: 'a' }))).toBe(true);
    expect(bus.emit(makeAlert('budget_breach', 'critical', 'x', { loopId: 'b' }))).toBe(true);
  });
});

describe('RefusalStormDetector', () => {
  it('fires when refusals reach the threshold within the window', () => {
    const d = new RefusalStormDetector(3, 60_000);
    expect(d.record(0)).toBe(false);
    expect(d.record(1_000)).toBe(false);
    expect(d.record(2_000)).toBe(true); // 3 in window
  });

  it('expires old refusals outside the window', () => {
    const d = new RefusalStormDetector(3, 60_000);
    d.record(0);
    d.record(1_000);
    // 2 minutes later: the first two have aged out
    expect(d.record(120_000)).toBe(false);
    expect(d.count).toBe(1);
  });
});

describe('StreamHealthMonitor', () => {
  it('flags a seq gap (lost frames)', () => {
    const m = new StreamHealthMonitor();
    expect(m.record(0, 0)).toBeNull();
    expect(m.record(1, 100)).toBeNull();
    expect(m.record(5, 200)).toBe('gap');
  });

  it('flags reordering', () => {
    const m = new StreamHealthMonitor();
    m.record(5, 0);
    expect(m.record(3, 100)).toBe('reorder');
  });

  it('flags staleness (missed heartbeat)', () => {
    const m = new StreamHealthMonitor(30_000);
    m.record(0, 0);
    expect(m.record(1, 40_000)).toBe('stale');
    expect(m.isStale(80_000)).toBe(true);
  });
});
