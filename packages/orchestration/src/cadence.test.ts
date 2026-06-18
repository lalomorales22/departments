import { describe, expect, it } from 'vitest';
import { cadenceFloorMs, isManualCadence, CadenceController, DEFAULT_CADENCE_FLOOR_MS } from './cadence.js';

describe('cadenceFloorMs', () => {
  it('maps known tiers to their floors', () => {
    expect(cadenceFloorMs('continuous')).toBe(5_000);
    expect(cadenceFloorMs('hourly')).toBe(3_600_000);
    expect(cadenceFloorMs('daily')).toBe(86_400_000);
    expect(cadenceFloorMs('nightly')).toBe(86_400_000);
    expect(cadenceFloorMs('weekly')).toBe(604_800_000);
  });

  it('treats manual / on-demand as no-floor (signal-only)', () => {
    expect(cadenceFloorMs('manual')).toBe(0);
    expect(cadenceFloorMs('on-demand')).toBe(0);
    expect(isManualCadence('manual')).toBe(true);
    expect(isManualCadence('continuous')).toBe(false);
  });

  it('is case/whitespace-insensitive and defaults unknown to the continuous floor', () => {
    expect(cadenceFloorMs('  HOURLY ')).toBe(3_600_000);
    expect(cadenceFloorMs('quarterly')).toBe(DEFAULT_CADENCE_FLOOR_MS);
  });
});

describe('CadenceController', () => {
  it('allows the first tick, then enforces the floor', () => {
    const c = new CadenceController();
    expect(c.delayUntilAllowed('l', 'continuous', 1_000)).toBe(0); // never ticked → allowed
    c.recordTick('l', 1_000);
    // 2s later under a 5s floor → must wait 3s.
    expect(c.delayUntilAllowed('l', 'continuous', 3_000)).toBe(3_000);
    expect(c.allowed('l', 'continuous', 3_000)).toBe(false);
    // 6s later → floor satisfied.
    expect(c.delayUntilAllowed('l', 'continuous', 7_000)).toBe(0);
    expect(c.allowed('l', 'continuous', 7_000)).toBe(true);
  });

  it('never delays a manual cadence', () => {
    const c = new CadenceController();
    c.recordTick('m', 1_000);
    expect(c.delayUntilAllowed('m', 'manual', 1_001)).toBe(0);
  });
});
