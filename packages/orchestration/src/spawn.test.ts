import { describe, expect, it } from 'vitest';
import {
  SpawnController,
  autoApproveSpawnGate,
  denySpawnGate,
  ManualSpawnGate,
  type SpawnRequest,
} from './spawn.js';

function req(over: Partial<SpawnRequest> = {}): SpawnRequest {
  return {
    orgId: 'org',
    parentLoopId: 'loop-parent',
    childName: 'child-a',
    mission: 'do a thing',
    parentLevel: 1,
    ...over,
  };
}

describe('SpawnController — structural pre-flight', () => {
  it('denies when the child would exceed max depth', () => {
    const c = new SpawnController({ maxDepth: 4 });
    const r = c.check(req({ parentLevel: 4 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/max depth/);
  });

  it('denies when the per-org child cap is reached', async () => {
    const c = new SpawnController({ perOrgChildCap: 1 });
    await c.resolve(req({ childName: 'c1' }), autoApproveSpawnGate);
    const r = c.check(req({ childName: 'c2' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/per-org child cap/);
  });

  it('passes a within-limits request', () => {
    const c = new SpawnController();
    const r = c.check(req());
    expect(r).toEqual({ ok: true, childLevel: 2 });
  });
});

describe('SpawnController.resolve — approval flow', () => {
  it('allows an approved spawn and increments the org child count', async () => {
    const c = new SpawnController();
    const v = await c.resolve(req(), autoApproveSpawnGate);
    expect(v).toEqual({ decision: 'allow', childLevel: 2 });
    expect(c.childCount('org')).toBe(1);
    expect(c.isSpawned(req())).toBe(true);
  });

  it('denies via the gate and BLOCKS re-requesting the same child (denial-loop guard)', async () => {
    const c = new SpawnController();
    const first = await c.resolve(req(), denySpawnGate('too risky'));
    expect(first).toEqual({ decision: 'deny', reason: 'too risky' });
    expect(c.isDenied(req())).toBe(true);
    // A re-request of the SAME (parent, child) is auto-denied without re-prompting —
    // even with an approving gate — so a denied spawn can't loop.
    const second = await c.resolve(req(), autoApproveSpawnGate);
    expect(second.decision).toBe('deny');
    if (second.decision === 'deny') expect(second.reason).toMatch(/denial-loop guard/);
    expect(c.childCount('org')).toBe(0);
  });

  it('does not double-spawn an existing child', async () => {
    const c = new SpawnController();
    await c.resolve(req(), autoApproveSpawnGate);
    const again = await c.resolve(req(), autoApproveSpawnGate);
    expect(again.decision).toBe('deny');
    if (again.decision === 'deny') expect(again.reason).toMatch(/already exists/);
  });

  it('caps the awaiting-approval queue', async () => {
    const c = new SpawnController({ maxQueued: 1 });
    const gate = new ManualSpawnGate();
    const p1 = c.resolve(req({ childName: 'q1' }), gate); // enters the queue, blocks
    await Promise.resolve();
    expect(c.queuedCount('org')).toBe(1);
    // Second request sees a full queue and is denied immediately.
    const v2 = await c.resolve(req({ childName: 'q2' }), gate);
    expect(v2.decision).toBe('deny');
    if (v2.decision === 'deny') expect(v2.reason).toMatch(/queue full/);
    gate.decide({ approve: true });
    expect((await p1).decision).toBe('allow');
    expect(c.queuedCount('org')).toBe(0);
  });
});
