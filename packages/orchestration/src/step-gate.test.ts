import { describe, expect, it } from 'vitest';
import { autoStepGate, ManualStepGate, type StepContext } from './step-gate.js';

const ctx: StepContext = { loopId: 'L', runId: 'r', cycle: 1, phase: 'plan', iteration: 0 };

describe('autoStepGate', () => {
  it('never blocks', async () => {
    await expect(autoStepGate.beforePhase(ctx)).resolves.toBeUndefined();
  });
});

describe('ManualStepGate', () => {
  it('blocks beforePhase until step() is called', async () => {
    const gate = new ManualStepGate();
    let resolved = false;
    const p = gate.beforePhase(ctx).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(gate.pending).toBe(1);
    gate.step();
    await p;
    expect(resolved).toBe(true);
    expect(gate.pending).toBe(0);
  });

  it('banks an early step() as a credit so the next phase proceeds without waiting', async () => {
    const gate = new ManualStepGate();
    gate.step(); // credit
    await expect(gate.beforePhase(ctx)).resolves.toBeUndefined();
  });

  it('releaseAll() unblocks every waiter and lets future phases proceed', async () => {
    const gate = new ManualStepGate();
    const a = gate.beforePhase(ctx);
    const b = gate.beforePhase({ ...ctx, phase: 'execute' });
    gate.releaseAll();
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
    // After release, no further blocking.
    await expect(gate.beforePhase({ ...ctx, phase: 'memory' })).resolves.toBeUndefined();
  });
});
