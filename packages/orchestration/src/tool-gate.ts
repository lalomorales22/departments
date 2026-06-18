/**
 * tool-gate.ts — `always_ask` human-in-the-loop confirmation for irreversible tools.
 *
 * Autonomy scales in Phase 4, so irreversible actions (deploy / send / spend /
 * delete) must pause for a Commander (or an auto-policy) before they run — the
 * README's "human-on-top" guardrail. The runtime raises a {@link ToolConfirmInput}
 * for such a tool; the engine consults a {@link ToolGate} and routes the verdict
 * back, a denial carrying a reason the agent can act on. This MIRRORS the
 * {@link StepGate} pattern: an async seam the engine `await`s, with a no-op default,
 * a policy default, and a manual (FIFO) gate the cockpit drives.
 *
 * The gate is consulted ONLY for irreversible tools ({@link isIrreversibleTool}) —
 * reversible tool calls never block. Precedence note: a tool denial reroutes work
 * but does NOT pause the loop; budget-cap pauses and the no-progress detector remain
 * the loop-level halts (caps + gates win, per the precedence rule).
 */
import type { ToolConfirmInput, ToolConfirmResult } from '@departments/agent-runtime';
import type { CyclePhase } from '@departments/shared';

/** A confirmation request enriched with the loop/run/phase the engine adds. */
export interface ToolConfirmRequest extends ToolConfirmInput {
  loopId: string;
  runId: string;
  phase: CyclePhase;
}

export type ToolDecision = ToolConfirmResult;

/** The async confirmation seam the engine awaits for an irreversible tool. */
export interface ToolGate {
  confirm(req: ToolConfirmRequest): Promise<ToolDecision>;
}

/**
 * Tool-name patterns that mark an IRREVERSIBLE action. Matched case-insensitively
 * against the (possibly namespaced) tool name, e.g. `github.deploy`, `email.send`,
 * `mcp:stripe.charge`, `fs.delete`. Deliberately broad: false positives only add a
 * confirmation prompt, false negatives let an irreversible action through unasked.
 */
export const IRREVERSIBLE_TOOL_PATTERNS: readonly RegExp[] = [
  /deploy|publish|release|ship|launch/i,
  /send|email|post|notify|message|sms|call/i,
  /spend|pay|charge|purchase|checkout|refund|invoice|wire/i,
  /delete|destroy|drop|remove|purge|wipe|truncate/i,
  /transfer|merge|revoke|grant|rotate/i,
];

/** Whether a tool name denotes an irreversible action that `always_ask` must gate. */
export function isIrreversibleTool(tool: string): boolean {
  return IRREVERSIBLE_TOOL_PATTERNS.some((re) => re.test(tool));
}

/** The default: approve every confirmation (trusted/attended loops). */
export const autoApproveToolGate: ToolGate = {
  async confirm(): Promise<ToolDecision> {
    return { allow: true };
  },
};

/**
 * A policy gate that DENIES every irreversible action with a stable reason — the
 * safe default for an unattended autonomous loop (deny-by-default; a human can flip
 * the policy or use a {@link ManualToolGate}).
 */
export function denyToolGate(
  reason = 'irreversible action blocked by always_ask policy (no approver attached)',
): ToolGate {
  return {
    async confirm(): Promise<ToolDecision> {
      return { allow: false, reason };
    },
  };
}

/**
 * A FIFO manual gate (mirrors {@link ManualStepGate}). Each `confirm` blocks until a
 * matching {@link decide} arrives; the cockpit's confirmation prompt calls `decide`
 * with the Commander's verdict. `releaseAll` denies everything outstanding on
 * teardown so a stopped loop never hangs on a pending confirmation.
 */
export class ManualToolGate implements ToolGate {
  private readonly waiters: Array<(d: ToolDecision) => void> = [];
  private readonly banked: ToolDecision[] = [];
  private released = false;

  async confirm(_req: ToolConfirmRequest): Promise<ToolDecision> {
    if (this.released) return { allow: false, reason: 'gate released' };
    const early = this.banked.shift();
    if (early) return early;
    return new Promise<ToolDecision>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Resolve the OLDEST pending confirmation, or bank the verdict for the next one. */
  decide(decision: ToolDecision): void {
    const next = this.waiters.shift();
    if (next) next(decision);
    else this.banked.push(decision);
  }

  /** Deny every outstanding confirmation and let future ones fail closed (teardown). */
  releaseAll(): void {
    this.released = true;
    while (this.waiters.length > 0) this.waiters.shift()?.({ allow: false, reason: 'gate released' });
  }

  /** Number of confirmations currently blocked awaiting a decision. */
  get pending(): number {
    return this.waiters.length;
  }
}
