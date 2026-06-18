/**
 * escalation.ts — data-driven capability escalation, SUBORDINATE to budget caps.
 *
 * On repeated grader failure a loop may bump its capability (effort, then model
 * tier) to break out of a rework rut, then DECAY back down once it passes cleanly.
 * The bump itself is proposed by {@link escalateOneTier} in `@departments/agent-runtime`;
 * this controller threads the *level* across reworks/cycles and — crucially — applies
 * the README/TASKS precedence rule that the bump can never override cost control:
 *
 *   - if the (loop ∪ org) cap is anything but `ok` (soft → downgrade, hard → pause),
 *     the escalation is REFUSED — a soft-cap downgrade always wins over an upgrade;
 *   - even when the cap is `ok`, the escalated call must fit inside the remaining
 *     HARD-cap headroom, or it is REFUSED — an escalation may never push a loop past
 *     its hard cap.
 *
 * Pure + deterministic (no IO/clock); unit-tested in `escalation.test.ts`.
 */
import { estimateCallCostUsd, type CapAction } from '@departments/cost';
import { escalateOneTier, type Effort, type ModelId } from '@departments/agent-runtime';

/** A model+effort the escalation operates on (the engine's RoleModel, narrowed). */
export interface CapabilityModel {
  modelId: ModelId;
  effort: Effort | null;
}

/** The cap context the precedence rule consults when resolving an escalation. */
export interface EscalationGate {
  /** Stricter of the loop and org cap actions; escalation applies only when `ok`. */
  capAction: CapAction;
  /** Min of the loop and org hard-cap headroom in USD; the bump must fit inside it. */
  headroomUsd: number;
}

/** The resolved capability for a phase, plus why it landed where it did. */
export interface EscalationProposal extends CapabilityModel {
  /** Tiers above the base this proposal sits (0 = base / unescalated). */
  level: number;
  /** True when a non-zero level was REFUSED by the cap/headroom precedence rule. */
  refused: boolean;
}

/**
 * Threads the escalation level across a loop's reworks and cycles. The composition
 * root (local-driver / Temporal activity) owns one per loop so decay persists across
 * cycles; the engine bumps it on grader failure and decays it on a clean pass.
 */
export class EscalationController {
  private level = 0;

  /** Upper bound on the bump (default 2 tiers) so escalation can't run away. */
  constructor(private readonly maxLevel = 2) {}

  /** Repeated grader failure bumps the capability level (bounded by `maxLevel`). */
  recordFailure(): void {
    this.level = Math.min(this.maxLevel, this.level + 1);
  }

  /** A clean pass decays the level by one (the data-driven decay half of the rule). */
  recordCleanPass(): void {
    this.level = Math.max(0, this.level - 1);
  }

  /** Current escalation level (0 = unescalated). */
  get currentLevel(): number {
    return this.level;
  }

  /**
   * Resolve the model to actually run for `base` at the current level, applying the
   * precedence rule. Returns `base` (level 0) with `refused:true` when a non-zero
   * level is blocked by the cap or by insufficient hard-cap headroom.
   */
  resolve(base: CapabilityModel, gate: EscalationGate): EscalationProposal {
    if (this.level === 0) return { ...base, level: 0, refused: false };
    // Caps override escalation: any non-`ok` cap action refuses the bump outright.
    if (gate.capAction !== 'ok') return { ...base, level: 0, refused: true };

    // Climb `level` legal tiers from the base.
    let cur: CapabilityModel = { modelId: base.modelId, effort: base.effort };
    for (let i = 0; i < this.level; i += 1) {
      const next = escalateOneTier(cur.modelId, cur.effort);
      cur = { modelId: next.modelId, effort: next.effort };
    }

    // An escalation may never breach the hard cap: the escalated call must fit in
    // the remaining headroom (projected at a conservative nominal tick).
    const projected = estimateCallCostUsd(cur.modelId);
    if (projected > gate.headroomUsd) return { ...base, level: 0, refused: true };

    return { ...cur, level: this.level, refused: false };
  }
}
