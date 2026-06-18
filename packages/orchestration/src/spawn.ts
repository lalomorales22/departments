/**
 * spawn.ts — CHILD-LOOP SPAWNING behind a manual-approval gate (Phase 4 hierarchy).
 *
 * "Loops all the way down" is the point of Phase 4 — but unbounded self-spawning is the
 * headline runaway risk. So a loop may only create a child when ALL of these hold:
 *   - the child's level stays within `maxDepth` (L4 workers are the leaves);
 *   - the org is under its `perOrgChildCap` total children;
 *   - the pending-spawn queue is under `maxQueued`;
 *   - the (parent, child) pair was not already DENIED — a denied spawn can't be
 *     re-requested in a loop (the denial-loop guard);
 *   - a human (Commander) — or an auto-policy — APPROVES it via a {@link SpawnGate}.
 *
 * {@link SpawnController} owns the structural rules + bookkeeping (pure, deterministic);
 * the {@link SpawnGate} owns the async approval (mirrors `StepGate`/`ToolGate`). The
 * driver/Temporal activity composes them via {@link SpawnController.resolve}.
 */
import type { LoopLevel } from '@departments/shared';

export interface SpawnRequest {
  orgId: string;
  parentLoopId: string;
  /** One-word child handle (the `loop <name>` id), unique within its parent. */
  childName: string;
  mission: string;
  /** The parent's level; the child will be `parentLevel + 1`. */
  parentLevel: LoopLevel;
}

/** The Commander/auto-policy verdict on a queued spawn. */
export interface SpawnDecision {
  approve: boolean;
  /** Reason carried back on a denial (also recorded for the denial-loop guard). */
  reason?: string;
}

/** The async approval seam (manual gate, or an auto-policy). */
export interface SpawnGate {
  confirm(req: SpawnRequest): Promise<SpawnDecision>;
}

/** Outcome of a full spawn flow. `allow` carries the resolved child level. */
export type SpawnVerdict =
  | { decision: 'allow'; childLevel: LoopLevel }
  | { decision: 'deny'; reason: string };

/** Pre-flight structural check result. */
export type SpawnCheck = { ok: true; childLevel: LoopLevel } | { ok: false; reason: string };

export interface SpawnPolicy {
  /** Deepest child level allowed (default 4 — L4 worker loops are the leaves). */
  maxDepth?: LoopLevel;
  /** Max total child loops per org (default 32). */
  perOrgChildCap?: number;
  /** Max queued (awaiting-approval) spawn requests per org (default 16). */
  maxQueued?: number;
}

function key(req: SpawnRequest): string {
  return `${req.orgId}:${req.parentLoopId}:${req.childName}`;
}

export class SpawnController {
  private readonly maxDepth: LoopLevel;
  private readonly perOrgChildCap: number;
  private readonly maxQueued: number;

  /** Child loops created per org. */
  private readonly childCounts = new Map<string, number>();
  /** (parent,child) keys already spawned — block duplicate spawns. */
  private readonly spawned = new Set<string>();
  /** (parent,child) keys already denied — the denial-loop guard. */
  private readonly denied = new Set<string>();
  /** Queued (awaiting-approval) request count per org. */
  private readonly queued = new Map<string, number>();

  constructor(policy: SpawnPolicy = {}) {
    this.maxDepth = (policy.maxDepth ?? 4) as LoopLevel;
    this.perOrgChildCap = Math.max(0, policy.perOrgChildCap ?? 32);
    this.maxQueued = Math.max(1, policy.maxQueued ?? 16);
  }

  childCount(orgId: string): number {
    return this.childCounts.get(orgId) ?? 0;
  }
  queuedCount(orgId: string): number {
    return this.queued.get(orgId) ?? 0;
  }
  isDenied(req: SpawnRequest): boolean {
    return this.denied.has(key(req));
  }
  isSpawned(req: SpawnRequest): boolean {
    return this.spawned.has(key(req));
  }

  /** Structural pre-flight — everything except the human approval. */
  check(req: SpawnRequest): SpawnCheck {
    const childLevel = (req.parentLevel + 1) as LoopLevel;
    if (childLevel > this.maxDepth) {
      return { ok: false, reason: `max depth reached (L${this.maxDepth}); cannot spawn an L${childLevel} child.` };
    }
    if (this.isDenied(req)) {
      return { ok: false, reason: `spawn "${req.childName}" was previously denied — re-request blocked (denial-loop guard).` };
    }
    if (this.isSpawned(req)) {
      return { ok: false, reason: `child "${req.childName}" already exists under this parent.` };
    }
    if (this.childCount(req.orgId) >= this.perOrgChildCap) {
      return { ok: false, reason: `per-org child cap reached (${this.perOrgChildCap}).` };
    }
    if (this.queuedCount(req.orgId) >= this.maxQueued) {
      return { ok: false, reason: `spawn queue full (${this.maxQueued} pending approvals).` };
    }
    return { ok: true, childLevel };
  }

  private enqueue(orgId: string): void {
    this.queued.set(orgId, this.queuedCount(orgId) + 1);
  }
  private dequeue(orgId: string): void {
    this.queued.set(orgId, Math.max(0, this.queuedCount(orgId) - 1));
  }

  /** Record an approved spawn (child created) — bumps the org count, marks it known. */
  recordApproved(req: SpawnRequest): void {
    this.spawned.add(key(req));
    this.childCounts.set(req.orgId, this.childCount(req.orgId) + 1);
  }

  /** Record a denied spawn so the same (parent,child) cannot be re-requested. */
  recordDenied(req: SpawnRequest): void {
    this.denied.add(key(req));
  }

  /**
   * The full flow: structural pre-flight → enqueue → human approval → record. Returns
   * `allow` (with the child level) only when the request passed every rule AND the gate
   * approved it; otherwise `deny` with a reason (and a denial is remembered).
   */
  async resolve(req: SpawnRequest, gate: SpawnGate): Promise<SpawnVerdict> {
    const pre = this.check(req);
    if (!pre.ok) return { decision: 'deny', reason: pre.reason };

    this.enqueue(req.orgId);
    let decision: SpawnDecision;
    try {
      decision = await gate.confirm(req);
    } finally {
      this.dequeue(req.orgId);
    }

    if (!decision.approve) {
      this.recordDenied(req);
      return { decision: 'deny', reason: decision.reason ?? 'denied by approver' };
    }
    // Re-check the cap after the (possibly slow) approval — concurrent approvals can't
    // overshoot the per-org cap.
    if (this.childCount(req.orgId) >= this.perOrgChildCap) {
      return { decision: 'deny', reason: `per-org child cap reached (${this.perOrgChildCap}) before approval landed.` };
    }
    this.recordApproved(req);
    return { decision: 'allow', childLevel: pre.childLevel };
  }
}

// ── Gates (mirror StepGate / ToolGate) ─────────────────────────────────────────

export const autoApproveSpawnGate: SpawnGate = {
  async confirm(): Promise<SpawnDecision> {
    return { approve: true };
  },
};

export function denySpawnGate(reason = 'spawn denied by policy (no approver attached)'): SpawnGate {
  return {
    async confirm(): Promise<SpawnDecision> {
      return { approve: false, reason };
    },
  };
}

/** FIFO manual gate — the cockpit's child-spawn approval banner drives {@link decide}. */
export class ManualSpawnGate implements SpawnGate {
  private readonly waiters: Array<(d: SpawnDecision) => void> = [];
  private readonly banked: SpawnDecision[] = [];
  private released = false;

  async confirm(_req: SpawnRequest): Promise<SpawnDecision> {
    if (this.released) return { approve: false, reason: 'gate released' };
    const early = this.banked.shift();
    if (early) return early;
    return new Promise<SpawnDecision>((resolve) => this.waiters.push(resolve));
  }

  /** Resolve the OLDEST pending approval, or bank the verdict for the next one. */
  decide(decision: SpawnDecision): void {
    const next = this.waiters.shift();
    if (next) next(decision);
    else this.banked.push(decision);
  }

  releaseAll(): void {
    this.released = true;
    while (this.waiters.length > 0) this.waiters.shift()?.({ approve: false, reason: 'gate released' });
  }

  get pending(): number {
    return this.waiters.length;
  }
}
