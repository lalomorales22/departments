/**
 * @departments/cost — the budget ledger.
 *
 * A loop "re-runs constantly," so cost discipline is structural, not optional
 * (see README → Cost control). This module owns the *ledger math + cap signals*
 * only: it accumulates per-loop and per-org spend from token usage, and reports
 * whether a scope is within budget, over its soft cap, or over its hard cap.
 *
 * It does NOT enforce anything. The precedence rule from the README's
 * "human-on-top guardrails" — **cost caps and human gates OVERRIDE autonomy and
 * capability escalation; a soft-cap downgrade always wins over an escalation
 * upgrade, and an escalation bump may never push a loop past its hard cap** — is
 * applied by the orchestration engine in Phase 4. This file is the source of the
 * `state`/`action` signals that rule consumes; it is pure, testable math here.
 *
 * Persistence is an in-memory `Map` (typed, swappable): Phase 2+ swaps the store
 * for Postgres/Redis without changing the public surface.
 */
import type { AccentKey } from '@departments/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Model price table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * USD per 1,000,000 tokens, per the model-tiering table in the README
 * ("The AI layer & model tiering"). These are the authoritative tier prices:
 *   - Opus 4.8   `claude-opus-4-8`    $5  in / $25 out
 *   - Fable 5    `claude-fable-5`     $10 in / $50 out
 *   - Sonnet 4.6 `claude-sonnet-4-6`  $3  in / $15 out
 *   - Haiku 4.5  `claude-haiku-4-5`   $1  in / $5  out
 *
 * The whole point of tiering: a naive "everything on Opus" design costs ~5× the
 * tiered design — Haiku is cheaper than Opus for the same tokens.
 */
export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
}

/** Canonical tier model IDs (the exact strings the runtime sends to the API). */
export const OPUS_MODEL_ID = 'claude-opus-4-8' as const;
export const FABLE_MODEL_ID = 'claude-fable-5' as const;
export const SONNET_MODEL_ID = 'claude-sonnet-4-6' as const;
export const HAIKU_MODEL_ID = 'claude-haiku-4-5' as const;
/**
 * Sentinel id for any locally-served (Ollama) model. Priced at $0 — it runs on the
 * user's own hardware. CRITICAL: without this entry, {@link priceFor} would fall back to
 * the Opus tier ($5/$25) for the unknown id and a free local loop would burn a fake
 * budget and trip the hard-cap pause. Keep it in lockstep with the `ollama-local`
 * MODEL_TIERS entry in @departments/agent-runtime.
 */
export const OLLAMA_LOCAL_MODEL_ID = 'ollama-local' as const;

/** The price table, keyed by exact model ID. */
export const PRICE_TABLE: Readonly<Record<string, ModelPrice>> = {
  [OPUS_MODEL_ID]: { inputPerMTok: 5, outputPerMTok: 25 },
  [FABLE_MODEL_ID]: { inputPerMTok: 10, outputPerMTok: 50 },
  [SONNET_MODEL_ID]: { inputPerMTok: 3, outputPerMTok: 15 },
  [HAIKU_MODEL_ID]: { inputPerMTok: 1, outputPerMTok: 5 },
  // Local models cost nothing — they run on the user's machine.
  [OLLAMA_LOCAL_MODEL_ID]: { inputPerMTok: 0, outputPerMTok: 0 },
};

/**
 * Cache reads are billed at ~0.1× the input price (the #1 cost lever — the large,
 * stable repeated prefix across every tick is served from cache). Cache *writes*
 * cost ~1.25× the input price (5-minute TTL). Both are expressed as multipliers
 * of the model's input price.
 */
export const CACHE_READ_MULTIPLIER = 0.1 as const;
export const CACHE_WRITE_MULTIPLIER = 1.25 as const;

/** Fallback price for an unknown model ID — treated as Opus-tier (conservative). */
const UNKNOWN_MODEL_PRICE: ModelPrice = PRICE_TABLE[OPUS_MODEL_ID]!;

/** Resolve a model ID to its price, defaulting to the (most expensive) Opus tier. */
export function priceFor(modelId: string): ModelPrice {
  return PRICE_TABLE[modelId] ?? UNKNOWN_MODEL_PRICE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage → cost
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One model call's token usage. Field names mirror `TokenUsage` from
 * `@departments/shared` and the CMA `span.model_request_end` `model_usage` shape.
 *
 * Token accounting note: `inputTokens` is the *uncached* remainder only — the
 * total prompt size is `inputTokens + cacheReadInputTokens +
 * cacheCreationInputTokens`. We price each bucket at its own rate.
 */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from cache (~0.1× input price). */
  cacheReadInputTokens: number;
  /** Tokens written to cache (~1.25× input price). */
  cacheCreationInputTokens: number;
}

const PER_MTOK = 1_000_000;

/**
 * Cost of a single call in USD, summing the four token buckets at their rates:
 *   uncached input · output · cache-read (0.1× input) · cache-write (1.25× input).
 */
export function costOfUsage(usage: ModelUsage, modelId: string): number {
  const price = priceFor(modelId);
  const input = (usage.inputTokens / PER_MTOK) * price.inputPerMTok;
  const output = (usage.outputTokens / PER_MTOK) * price.outputPerMTok;
  const cacheRead =
    (usage.cacheReadInputTokens / PER_MTOK) * price.inputPerMTok * CACHE_READ_MULTIPLIER;
  const cacheWrite =
    (usage.cacheCreationInputTokens / PER_MTOK) * price.inputPerMTok * CACHE_WRITE_MULTIPLIER;
  return input + output + cacheRead + cacheWrite;
}

/**
 * The Batch API bills at 50% of the synchronous rate (cost lever #3:
 * caching → tiering → **batching** → effort). The CEO meta-loop submits its
 * can-wait review fan-out (N child REPORT/Metric summaries sharing one cached
 * prefix) as a single batch; the ledger prices those calls through this helper so
 * the 50% saving is *accounted*, not just asserted.
 */
export const BATCH_DISCOUNT_MULTIPLIER = 0.5 as const;

/** Cost of one call submitted via the Batch API (50% off the synchronous price). */
export function batchCostOfUsage(usage: ModelUsage, modelId: string): number {
  return costOfUsage(usage, modelId) * BATCH_DISCOUNT_MULTIPLIER;
}

/** The synchronous vs batch cost of a call and the USD saved by batching it. */
export interface BatchSavings {
  syncCostUsd: number;
  batchCostUsd: number;
  savingUsd: number;
}

/**
 * Quantify the Batch-API saving for one call (cost lever #3). The CEO sweep + bulk
 * worker classify/lint/summarize go through Batch; the dashboard shows this so the
 * 50% lever is *proven*, not asserted.
 */
export function batchSavings(usage: ModelUsage, modelId: string): BatchSavings {
  const syncCostUsd = costOfUsage(usage, modelId);
  const batchCostUsd = syncCostUsd * BATCH_DISCOUNT_MULTIPLIER;
  return { syncCostUsd, batchCostUsd, savingUsd: syncCostUsd - batchCostUsd };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fable-5 cost-approval gate (Phase 5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Fable-5 path is RESERVED for quarterly strategy / greenfield work and is gated
 * behind explicit cost approval — its blended price ($10 in / $50 out) is 2× Opus, so
 * it is never selected silently. The engine downgrades an UNAPPROVED Fable role to Opus
 * and emits `fable-approval-required` so the Commander can approve the spend; once
 * approved, the role runs on Fable. The gate is membership-based (Fable is gated,
 * period), not a soft cost threshold — the projected cost is shown as the reason.
 */
export function requiresFableApproval(modelId: string): boolean {
  return modelId === FABLE_MODEL_ID;
}

/**
 * Projected USD for one full (five-phase) cycle on a model, for the Fable approval
 * prompt / dashboard. Uses the conservative {@link NOMINAL_TICK_USAGE} per phase.
 */
export function projectedCycleUsd(modelId: string, phases = 5): number {
  return estimateCallCostUsd(modelId) * phases;
}

/**
 * A representative single-tick usage, used ONLY to *project* the marginal cost of
 * one more model call (the escalation headroom guard, below). It is intentionally
 * conservative — mostly uncached input + a modest output — so the guard errs toward
 * refusing an escalation when headroom is thin rather than breaching the hard cap.
 */
export const NOMINAL_TICK_USAGE: ModelUsage = {
  inputTokens: 12_000,
  outputTokens: 2_000,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

/**
 * Project the marginal USD cost of one more call at `modelId` (defaults to a
 * conservative nominal tick). The engine's escalation guard compares this against
 * remaining headroom so a capability bump can never push a loop past its hard cap.
 */
export function estimateCallCostUsd(modelId: string, usage: ModelUsage = NOMINAL_TICK_USAGE): number {
  return costOfUsage(usage, modelId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Caps, state, and signals
// ─────────────────────────────────────────────────────────────────────────────

/** Scope of a usage record — a single run inside a loop inside an org. */
export interface UsageScope {
  orgId: string;
  loopId: string;
  /** Run/tick id — recorded for audit; spend rolls up to loop + org. */
  runId: string;
}

/** Where a scope sits relative to its caps. */
export type BudgetState = 'ok' | 'soft' | 'hard';

/**
 * The action the *engine* (Phase 4) should take given the state — the cap signal
 * the precedence rule consumes:
 *   - `'ok'`        → no constraint from cost.
 *   - `'downgrade'` → soft cap reached: drop effort/model one tier; this always
 *                     wins over a grader-failure escalation upgrade.
 *   - `'pause'`     → hard cap reached: pause the loop + alert; escalation may
 *                     never breach this.
 */
export type CapAction = 'ok' | 'downgrade' | 'pause';

/** A budget snapshot for one scope (a loop or the org rollup). */
export interface BudgetStatus {
  spentUsd: number;
  softCapUsd: number;
  hardCapUsd: number;
  state: BudgetState;
}

/**
 * Fraction of the hard cap at which the soft cap trips (auto-downgrade). The
 * README's example is 80%.
 */
export const DEFAULT_SOFT_CAP_FRACTION = 0.8 as const;

/** Resolve the {state} for a given spend against its caps. */
export function resolveState(spentUsd: number, softCapUsd: number, hardCapUsd: number): BudgetState {
  if (spentUsd >= hardCapUsd) return 'hard';
  if (spentUsd >= softCapUsd) return 'soft';
  return 'ok';
}

/** Map a budget state to the engine action signal. */
export function actionFor(state: BudgetState): CapAction {
  switch (state) {
    case 'hard':
      return 'pause';
    case 'soft':
      return 'downgrade';
    case 'ok':
      return 'ok';
  }
}

/** Severity order so the STRICTER of two cap actions can be chosen. */
const CAP_ACTION_SEVERITY: Readonly<Record<CapAction, number>> = { ok: 0, downgrade: 1, pause: 2 };

/**
 * The stricter of two cap actions (`pause` > `downgrade` > `ok`). A loop lives
 * under BOTH its own cap and the org-wide rollup cap; the engine takes the stricter
 * — so an org hard-cap breach pauses a loop that is itself only at its soft cap,
 * and the org soft cap downgrades a loop still nominally `ok`. This is the
 * structural form of "org-wide hard cap" enforcement from Phase 4.
 */
export function stricterAction(a: CapAction, b: CapAction): CapAction {
  return CAP_ACTION_SEVERITY[a] >= CAP_ACTION_SEVERITY[b] ? a : b;
}

/**
 * UI accent for a budget state — resolves through a key so callers never hardcode
 * which color a cap state is (mirrors the status-theme discipline). The web design
 * system maps these `AccentKey`s to CSS vars.
 */
export const BUDGET_STATE_ACCENT: Readonly<Record<BudgetState, AccentKey>> = {
  ok: 'green',
  soft: 'amber',
  hard: 'red',
};

// ─────────────────────────────────────────────────────────────────────────────
// The ledger
// ─────────────────────────────────────────────────────────────────────────────

/** Internal running row. Persistence is swappable — see {@link BudgetStore}. */
interface LoopRow {
  orgId: string;
  loopId: string;
  spentUsd: number;
  softCapUsd: number;
  hardCapUsd: number;
}

/** Swappable persistence seam. The default is an in-memory `Map`. */
export interface BudgetStore {
  getLoop(loopId: string): LoopRow | undefined;
  setLoop(row: LoopRow): void;
  /** All loop rows for an org (org rollup sums these). */
  loopsForOrg(orgId: string): LoopRow[];
}

/** Default in-memory store (typed; swap for Postgres/Redis in later phases). */
class InMemoryBudgetStore implements BudgetStore {
  private readonly rows = new Map<string, LoopRow>();

  getLoop(loopId: string): LoopRow | undefined {
    return this.rows.get(loopId);
  }

  setLoop(row: LoopRow): void {
    this.rows.set(row.loopId, row);
  }

  loopsForOrg(orgId: string): LoopRow[] {
    const out: LoopRow[] = [];
    for (const row of this.rows.values()) {
      if (row.orgId === orgId) out.push(row);
    }
    return out;
  }
}

/** Per-loop cap configuration used to register a loop before recording usage. */
export interface LoopBudgetConfig {
  orgId: string;
  loopId: string;
  /** Hard cap in USD (the loop's `budgetCapUsd`). */
  hardCapUsd: number;
  /**
   * Soft cap in USD. Defaults to {@link DEFAULT_SOFT_CAP_FRACTION} × hardCap.
   */
  softCapUsd?: number;
}

/** Per-org cap configuration (the org-wide rollup hard/soft caps). */
export interface OrgBudgetConfig {
  orgId: string;
  hardCapUsd: number;
  softCapUsd?: number;
}

/**
 * BudgetLedger — accumulates spend per loop and per org from token usage, and
 * reports cap state/action. Math is real and testable; storage is swappable.
 */
export class BudgetLedger {
  private readonly store: BudgetStore;
  private readonly orgCaps = new Map<string, { softCapUsd: number; hardCapUsd: number }>();

  constructor(store: BudgetStore = new InMemoryBudgetStore()) {
    this.store = store;
  }

  /**
   * Register (or re-configure) a loop's caps. Recording usage for an unknown loop
   * auto-registers it with a zero hard cap, so register first for meaningful caps.
   */
  registerLoop(config: LoopBudgetConfig): void {
    const existing = this.store.getLoop(config.loopId);
    this.store.setLoop({
      orgId: config.orgId,
      loopId: config.loopId,
      spentUsd: existing?.spentUsd ?? 0,
      hardCapUsd: config.hardCapUsd,
      softCapUsd: config.softCapUsd ?? config.hardCapUsd * DEFAULT_SOFT_CAP_FRACTION,
    });
  }

  /** Register (or re-configure) the org-wide rollup caps. */
  registerOrg(config: OrgBudgetConfig): void {
    this.orgCaps.set(config.orgId, {
      hardCapUsd: config.hardCapUsd,
      softCapUsd: config.softCapUsd ?? config.hardCapUsd * DEFAULT_SOFT_CAP_FRACTION,
    });
  }

  /**
   * Record one model call's usage and add its cost to the loop's running spend.
   * Org spend is derived (summed) on read, so a single record updates both the
   * per-loop and per-org views. Returns the cost just added.
   */
  recordUsage(scope: UsageScope, usage: ModelUsage, modelId: string): number {
    const cost = costOfUsage(usage, modelId);
    const existing = this.store.getLoop(scope.loopId);
    if (existing) {
      this.store.setLoop({ ...existing, spentUsd: existing.spentUsd + cost });
    } else {
      // Auto-register an unknown loop with no cap (zero) so spend is never lost.
      this.store.setLoop({
        orgId: scope.orgId,
        loopId: scope.loopId,
        spentUsd: cost,
        hardCapUsd: 0,
        softCapUsd: 0,
      });
    }
    return cost;
  }

  /** Budget snapshot for one loop. Unknown loop → all-zero `ok`. */
  status(loopId: string): BudgetStatus {
    const row = this.store.getLoop(loopId);
    if (!row) {
      return { spentUsd: 0, softCapUsd: 0, hardCapUsd: 0, state: 'ok' };
    }
    return {
      spentUsd: row.spentUsd,
      softCapUsd: row.softCapUsd,
      hardCapUsd: row.hardCapUsd,
      state: resolveState(row.spentUsd, row.softCapUsd, row.hardCapUsd),
    };
  }

  /**
   * Org rollup: spend is the SUM of all loop spend for the org; caps come from the
   * registered org config (zero if none registered).
   */
  orgStatus(orgId: string): BudgetStatus {
    const spentUsd = this.store.loopsForOrg(orgId).reduce((sum, row) => sum + row.spentUsd, 0);
    const caps = this.orgCaps.get(orgId);
    // An UNREGISTERED org (or a zero hard cap) means "no org-wide cap" → always `ok`.
    // Without this, every loop that merely scopes an orgId would read `hard` (spend ≥ 0)
    // and pause — the org cap must only bite when explicitly registered with a real cap.
    if (!caps || caps.hardCapUsd <= 0) {
      return { spentUsd, softCapUsd: 0, hardCapUsd: 0, state: 'ok' };
    }
    return {
      spentUsd,
      softCapUsd: caps.softCapUsd,
      hardCapUsd: caps.hardCapUsd,
      state: resolveState(spentUsd, caps.softCapUsd, caps.hardCapUsd),
    };
  }

  /**
   * The cap signal for a loop: `'ok'` | `'downgrade'` (soft) | `'pause'` (hard).
   * The engine (Phase 4) combines this with the org signal and lets the stricter
   * win — the precedence rule. Pure read; does not mutate.
   */
  checkCap(loopId: string): CapAction {
    return actionFor(this.status(loopId).state);
  }

  /** The cap signal for the org rollup. */
  checkOrgCap(orgId: string): CapAction {
    return actionFor(this.orgStatus(orgId).state);
  }

  /**
   * Remaining USD before the loop's HARD cap (`hardCap − spent`, floored at 0). A
   * hard cap of 0 means "uncapped" for the purpose of this guard and returns
   * `Infinity` — note that is distinct from {@link checkCap}, where a 0 hard cap
   * trips immediately; headroom is consulted only for the escalation projection,
   * which must not divide a real budget by an unset cap.
   */
  headroomUsd(loopId: string): number {
    const row = this.store.getLoop(loopId);
    if (!row || row.hardCapUsd <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(0, row.hardCapUsd - row.spentUsd);
  }

  /** Remaining USD before the ORG-wide hard cap (`Infinity` when the org is uncapped). */
  orgHeadroomUsd(orgId: string): number {
    const caps = this.orgCaps.get(orgId);
    if (!caps || caps.hardCapUsd <= 0) return Number.POSITIVE_INFINITY;
    const spentUsd = this.store.loopsForOrg(orgId).reduce((sum, row) => sum + row.spentUsd, 0);
    return Math.max(0, caps.hardCapUsd - spentUsd);
  }

  /**
   * The per-org budget DASHBOARD report (Phase 5): org spend + cap state, fraction of
   * the hard cap used, and a per-loop breakdown (each loop's spend + its share of org
   * spend + its own cap state), sorted biggest-spender-first. Feeds the cockpit's
   * per-org budget dashboard and the COST_GOVERNANCE runbook. Read-only.
   */
  orgReport(orgId: string): OrgBudgetReport {
    const org = this.orgStatus(orgId);
    const rows = this.store.loopsForOrg(orgId);
    const loops: OrgBudgetReportLoop[] = rows
      .map((row) => ({
        loopId: row.loopId,
        spentUsd: row.spentUsd,
        hardCapUsd: row.hardCapUsd,
        state: resolveState(row.spentUsd, row.softCapUsd, row.hardCapUsd),
        pctOfOrgSpend: org.spentUsd > 0 ? row.spentUsd / org.spentUsd : 0,
      }))
      .sort((a, b) => b.spentUsd - a.spentUsd);
    // Fraction of the hard cap used (0 when uncapped — distinct from "no spend").
    const utilization = org.hardCapUsd > 0 ? org.spentUsd / org.hardCapUsd : 0;
    return {
      orgId,
      spentUsd: org.spentUsd,
      softCapUsd: org.softCapUsd,
      hardCapUsd: org.hardCapUsd,
      state: org.state,
      capped: org.hardCapUsd > 0,
      utilization,
      headroomUsd: this.orgHeadroomUsd(orgId),
      loops,
    };
  }
}

/** One loop's row in the per-org budget report. */
export interface OrgBudgetReportLoop {
  loopId: string;
  spentUsd: number;
  hardCapUsd: number;
  state: BudgetState;
  /** This loop's share of the org's total spend (0–1). */
  pctOfOrgSpend: number;
}

/** The per-org budget dashboard report (org rollup + per-loop breakdown). */
export interface OrgBudgetReport {
  orgId: string;
  spentUsd: number;
  softCapUsd: number;
  hardCapUsd: number;
  state: BudgetState;
  /** False when the org has no registered hard cap ("no limit", not "infinite headroom"). */
  capped: boolean;
  /** Fraction of the hard cap used (0 when uncapped). */
  utilization: number;
  headroomUsd: number;
  loops: OrgBudgetReportLoop[];
}
