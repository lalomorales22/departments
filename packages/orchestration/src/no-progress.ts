/**
 * no-progress.ts — the live NO-PROGRESS DETECTOR (Phase 3 guardrail).
 *
 * A loop "re-runs constantly", so spinning-within-budget is a real failure mode the
 * budget cap can't catch. The detector watches, across cycles, two signals:
 *   - a MEANINGFUL artifact diff (`ArtifactSnapshot.meaningful`, which already excludes
 *     the always-rewritten `HANDOFF.md` so it can't be defeated by design), and
 *   - METRIC MOVEMENT (any emitted `metric` event with a non-zero delta).
 *
 * `H` consecutive cycles with NEITHER → drop the loop's health and auto-pause + alert.
 * This is a pure, deterministic state machine (no IO/clock) so it is unit-testable and
 * can be threaded across cycles by the composition root. It NEVER overrides the budget
 * cap / human gates — those still take precedence (the caller checks `paused` first).
 */

export interface ProgressSignal {
  /** At least one snapshot this cycle changed a non-HANDOFF artifact. */
  meaningful: boolean;
  /** At least one metric moved (non-zero delta) this cycle. */
  metricMoved: boolean;
}

export interface NoProgressConfig {
  /** Consecutive stalled cycles before auto-pause ("H"). Default 3. */
  threshold?: number;
  /** Health % lost per stalled cycle. Default 20. */
  healthDropPerStall?: number;
  /** Health % regained on a productive cycle. Default 10. */
  healthRecoverPerCycle?: number;
  /** Starting health. Default 100. */
  initialHealth?: number;
}

export interface ProgressOutcome {
  /** This cycle made no meaningful progress. */
  stalled: boolean;
  /** Consecutive stalled cycles so far. */
  consecutiveStalls: number;
  /** Current loop health (0–100), clamped. */
  health: number;
  /** True the moment the stall streak reaches the threshold — caller should auto-pause. */
  shouldPause: boolean;
}

export class NoProgressDetector {
  private readonly threshold: number;
  private readonly drop: number;
  private readonly recover: number;
  consecutiveStalls = 0;
  health: number;

  constructor(cfg: NoProgressConfig = {}) {
    this.threshold = Math.max(1, cfg.threshold ?? 3);
    this.drop = cfg.healthDropPerStall ?? 20;
    this.recover = cfg.healthRecoverPerCycle ?? 10;
    this.health = clampHealth(cfg.initialHealth ?? 100);
  }

  /** Fold one cycle's progress signal; returns the resulting health + pause decision. */
  record(signal: ProgressSignal): ProgressOutcome {
    const stalled = !signal.meaningful && !signal.metricMoved;
    if (stalled) {
      this.consecutiveStalls += 1;
      this.health = clampHealth(this.health - this.drop);
    } else {
      this.consecutiveStalls = 0;
      this.health = clampHealth(this.health + this.recover);
    }
    return {
      stalled,
      consecutiveStalls: this.consecutiveStalls,
      health: this.health,
      shouldPause: this.consecutiveStalls >= this.threshold,
    };
  }
}

function clampHealth(h: number): number {
  return h < 0 ? 0 : h > 100 ? 100 : Math.round(h);
}
