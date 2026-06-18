/**
 * cadence.ts — CADENCE FLOORS (a runaway guard), pure + deterministic.
 *
 * A loop "re-runs constantly", so without a floor a continuous tier could spin as
 * fast as the engine returns — burning budget and starving the concurrency pool.
 * Each tier carries a MINIMUM interval between ticks; a tick requested sooner is
 * delayed (locally) or slept-through (durably, in the Temporal `IDLE_WAIT`). This is
 * the per-tier floor the README/TASKS call for, enforced where autonomy scales.
 *
 * No IO/clock — `now` is injected — so it is unit-testable and safe to reuse inside a
 * deterministic Temporal workflow (which derives the duration, then `sleep()`s it).
 */

/** Minimum ms between ticks for each cadence string used across the org tree. */
const CADENCE_FLOOR_MS: Readonly<Record<string, number>> = {
  continuous: 5_000, //   even "continuous" floors at 5s between cycles
  high: 60_000, //        1 min
  hourly: 3_600_000, //   1 h
  daily: 86_400_000, //   24 h
  nightly: 86_400_000, // 24 h (alias of daily)
  weekly: 604_800_000, // 7 d
  manual: 0, //           signal-only; never auto-ticks (no floor to wait on)
  'on-demand': 0, //      signal-only
};

/** Conservative default for an unrecognized cadence — the continuous floor. */
export const DEFAULT_CADENCE_FLOOR_MS = 5_000;

/** The known cadence labels (for editors/validation). */
export const CADENCE_LABELS: readonly string[] = Object.keys(CADENCE_FLOOR_MS);

/** Minimum ms between ticks for a cadence string (unknown → conservative floor). */
export function cadenceFloorMs(cadence: string): number {
  return CADENCE_FLOOR_MS[cadence.toLowerCase().trim()] ?? DEFAULT_CADENCE_FLOOR_MS;
}

/** Whether a cadence is signal-only (manual/on-demand) and never auto-ticks. */
export function isManualCadence(cadence: string): boolean {
  return cadenceFloorMs(cadence) === 0;
}

/**
 * Tracks the last tick time per loop and reports how long a loop must wait before its
 * cadence floor allows the next tick. The composition root records a tick after each
 * cycle; the driver / workflow consults {@link delayUntilAllowed} before the next.
 */
export class CadenceController {
  private readonly last = new Map<string, number>();

  /** Record that `loopId` ticked at `nowMs`. */
  recordTick(loopId: string, nowMs: number): void {
    this.last.set(loopId, nowMs);
  }

  /**
   * Ms `loopId` must wait before it may tick again under `cadence` (0 = allowed now).
   * The first tick of a loop is always allowed; a manual cadence never imposes a wait.
   */
  delayUntilAllowed(loopId: string, cadence: string, nowMs: number): number {
    const floor = cadenceFloorMs(cadence);
    if (floor === 0) return 0;
    const prev = this.last.get(loopId);
    if (prev === undefined) return 0;
    const elapsed = nowMs - prev;
    return elapsed >= floor ? 0 : floor - elapsed;
  }

  /** Whether `loopId` may tick now under `cadence`. */
  allowed(loopId: string, cadence: string, nowMs: number): boolean {
    return this.delayUntilAllowed(loopId, cadence, nowMs) === 0;
  }
}
