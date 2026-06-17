import { describe, expect, it } from 'vitest';
import { NoProgressDetector } from './no-progress.js';

describe('NoProgressDetector', () => {
  it('treats a meaningful diff OR a moved metric as progress (no stall)', () => {
    const d = new NoProgressDetector();
    expect(d.record({ meaningful: true, metricMoved: false }).stalled).toBe(false);
    expect(d.record({ meaningful: false, metricMoved: true }).stalled).toBe(false);
    expect(d.consecutiveStalls).toBe(0);
  });

  it('counts a cycle with neither signal as a stall and drops health', () => {
    const d = new NoProgressDetector({ healthDropPerStall: 20, initialHealth: 100 });
    const o1 = d.record({ meaningful: false, metricMoved: false });
    expect(o1.stalled).toBe(true);
    expect(o1.consecutiveStalls).toBe(1);
    expect(o1.health).toBe(80);
  });

  it('auto-pauses at the H-th consecutive stall', () => {
    const d = new NoProgressDetector({ threshold: 3 });
    expect(d.record({ meaningful: false, metricMoved: false }).shouldPause).toBe(false);
    expect(d.record({ meaningful: false, metricMoved: false }).shouldPause).toBe(false);
    expect(d.record({ meaningful: false, metricMoved: false }).shouldPause).toBe(true);
  });

  it('resets the streak and recovers health on a productive cycle', () => {
    const d = new NoProgressDetector({ threshold: 3, healthDropPerStall: 30, healthRecoverPerCycle: 10 });
    d.record({ meaningful: false, metricMoved: false }); // health 70, stalls 1
    d.record({ meaningful: false, metricMoved: false }); // health 40, stalls 2
    const back = d.record({ meaningful: true, metricMoved: false }); // recover
    expect(back.stalled).toBe(false);
    expect(back.consecutiveStalls).toBe(0);
    expect(back.health).toBe(50);
  });

  it('clamps health to [0,100]', () => {
    const d = new NoProgressDetector({ healthDropPerStall: 60, initialHealth: 100 });
    d.record({ meaningful: false, metricMoved: false }); // 40
    const low = d.record({ meaningful: false, metricMoved: false }); // would be -20 → 0
    expect(low.health).toBe(0);
  });
});
