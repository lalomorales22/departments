/**
 * step-gate.ts — manual single-step control for the pipeline.
 *
 * The cockpit's Auto-Layout toggle (AUTO ↔ STEP) needs the engine to optionally PAUSE
 * before each phase and wait for an explicit "step" signal. This is modeled as a
 * `StepGate` the engine `await`s at every phase boundary. The default {@link autoStepGate}
 * resolves immediately (current behavior, zero overhead). {@link ManualStepGate} blocks
 * each phase until `step()` is called — the CLI wires stdin lines to `step()`, and the
 * web `/step` route writes a newline to the engine subprocess's stdin.
 */
import type { Phase } from '@departments/shared';

export interface StepContext {
  loopId: string;
  runId: string;
  cycle: number;
  phase: Phase;
  iteration: number;
}

export interface StepGate {
  /** Resolves when the engine may enter `ctx.phase`. Auto-mode resolves immediately. */
  beforePhase(ctx: StepContext): Promise<void>;
}

/** The default: never blocks. Used whenever no manual stepping is requested. */
export const autoStepGate: StepGate = {
  async beforePhase(): Promise<void> {
    /* proceed immediately */
  },
};

/**
 * A FIFO manual gate. Each `beforePhase` blocks until a matching `step()` arrives;
 * a `step()` that arrives early is credited so the next phase proceeds without waiting
 * (so the operator can queue steps). `releaseAll()` drains to auto on stop/teardown.
 */
export class ManualStepGate implements StepGate {
  private readonly waiters: Array<() => void> = [];
  private credits = 0;
  private released = false;

  async beforePhase(_ctx: StepContext): Promise<void> {
    if (this.released) return;
    if (this.credits > 0) {
      this.credits -= 1;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Advance one phase: release the oldest waiter, or bank a credit if none is waiting. */
  step(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.credits += 1;
  }

  /** Release every blocked phase and let all future phases proceed (teardown). */
  releaseAll(): void {
    this.released = true;
    while (this.waiters.length > 0) this.waiters.shift()?.();
  }

  /** Number of phases currently blocked waiting for a step. */
  get pending(): number {
    return this.waiters.length;
  }
}
