/**
 * @departments/agent-runtime/models — the model-tier + effort policy, encoded.
 *
 * This file is the machine-readable form of the "Authoritative model facts" table in
 * TASKS.md / README.md. It is the SINGLE source of truth for which (model, knob)
 * pairings are legal, so the same wrong pairing that would 400 against the API is
 * caught here at config/CI time instead. Do NOT "correct" these numbers from memory —
 * they mirror the docs verbatim.
 *
 * Cost levers, in order of impact (TASKS.md): caching → tiering → batching → effort.
 * This module owns the *tiering* knobs; caching/batching live in `@departments/cost`.
 */

// ─── Primitives ─────────────────────────────────────────────────────────────

/** The exact model ids in play. */
export type ModelId =
  | 'claude-opus-4-8'
  | 'claude-fable-5'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5';

/** The `output_config.effort` rungs. `xhigh`/`max` are the high-cost tiers. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Policy-tier roles. NOTE: this is the *tiering* taxonomy (mission altitude), distinct
 * from the per-loop agent roster (`AgentRole` in @departments/shared). The grader and
 * planner are both "judgment" work and share the Opus tier; executors map to Sonnet;
 * mechanical L4 workers to Haiku; gated greenfield strategy to Fable.
 */
export type ModelRole = 'judgment' | 'strategy' | 'executor' | 'worker';

/** A single subset of the knobs a request might carry, for validation. */
export interface ModelKnobs {
  /** `output_config.effort`. */
  readonly effort?: Effort;
  /** `thinking:{type:"adaptive"}` present. */
  readonly adaptiveThinking?: boolean;
  /** `thinking:{type:"disabled"}` present (the param that Fable must OMIT, not set). */
  readonly thinkingDisabled?: boolean;
  /** `thinking.budget_tokens` present. */
  readonly budgetTokens?: number;
  /** Any of `temperature`/`top_p`/`top_k` present. */
  readonly sampling?: boolean;
}

// ─── Policy entry ─────────────────────────────────────────────────────────────

export interface ModelTier {
  /** Policy-tier role this entry serves. */
  readonly role: ModelRole;
  readonly modelId: ModelId;
  /** Max context window in tokens (Haiku is the 200K outlier). */
  readonly contextTokens: number;
  /**
   * Whether `thinking:{type:"adaptive"}` is legal. Fable is "always-on" — it thinks
   * adaptively but you must OMIT the param (see {@link omitThinkingParam}); we model
   * that as `supportsAdaptiveThinking: true` + `omitThinkingParam: true`.
   */
  readonly supportsAdaptiveThinking: boolean;
  /**
   * Fable-only: adaptive thinking is always-on and the thinking param must be omitted
   * entirely (sending `disabled` 400s; sending `adaptive` is redundant/omit). When true,
   * the request should send NO `thinking` block at all.
   */
  readonly omitThinkingParam: boolean;
  /** Whether `output_config.effort` is a legal param at all (false → omit on Haiku). */
  readonly supportsEffort: boolean;
  /** The exact effort rungs allowed for this model (empty iff `supportsEffort` false). */
  readonly allowedEfforts: readonly Effort[];
  /** Default effort to apply when a caller doesn't pin one. `null` iff unsupported. */
  readonly defaultEffort: Effort | null;
  /** Price per 1M input tokens, USD. */
  readonly priceInPerM: number;
  /** Price per 1M output tokens, USD. */
  readonly priceOutPerM: number;
  readonly notes: string;
}

// ─── The policy table ─────────────────────────────────────────────────────────

/**
 * The authoritative tier table. One entry per model. Ordered cheapest-tier-of-judgment
 * first is irrelevant; what matters is each entry is internally consistent (asserted in
 * the CI test) and the (model, knob) rules are enforced by {@link validateKnobs}.
 */
export const MODEL_TIERS: readonly ModelTier[] = [
  {
    role: 'judgment',
    modelId: 'claude-opus-4-8',
    contextTokens: 1_000_000,
    supportsAdaptiveThinking: true,
    omitThinkingParam: false,
    supportsEffort: true,
    allowedEfforts: ['low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'high',
    priceInPerM: 5,
    priceOutPerM: 25,
    notes:
      'CEO meta-loop / Planner / Reviewer-grader. Adaptive thinking; effort default `high`, `xhigh` for hard agentic work. No budget_tokens, no temperature/top_p/top_k.',
  },
  {
    role: 'strategy',
    modelId: 'claude-fable-5',
    contextTokens: 1_000_000,
    // Always-on thinking: supported, but the thinking param must be OMITTED.
    supportsAdaptiveThinking: true,
    omitThinkingParam: true,
    supportsEffort: true,
    allowedEfforts: ['xhigh', 'max'],
    defaultEffort: 'xhigh',
    priceInPerM: 10,
    priceOutPerM: 50,
    notes:
      'Hardest CEO / greenfield strategy (gated). Always-on thinking — OMIT the thinking param (never thinking:{type:"disabled"}). Requires server-side fallbacks (betas:["server-side-fallback-2026-06-01"] → claude-opus-4-8) + 30-day retention. No budget_tokens, no temperature/top_p/top_k.',
  },
  {
    role: 'executor',
    modelId: 'claude-sonnet-4-6',
    contextTokens: 1_000_000,
    supportsAdaptiveThinking: true,
    omitThinkingParam: false,
    supportsEffort: true,
    // Caps at `max`; there is NO xhigh rung on Sonnet 4.6.
    allowedEfforts: ['low', 'medium', 'high', 'max'],
    defaultEffort: 'medium',
    priceInPerM: 3,
    priceOutPerM: 15,
    notes:
      'Executor agents (dev/content/SEO/analyst). Adaptive thinking; effort `medium`→`high`, ceiling `max`. NO `xhigh` rung. ',
  },
  {
    role: 'worker',
    modelId: 'claude-haiku-4-5',
    contextTokens: 200_000,
    // No adaptive thinking on Haiku.
    supportsAdaptiveThinking: false,
    omitThinkingParam: false,
    // The effort param ERRORS on Haiku — omit it entirely.
    supportsEffort: false,
    allowedEfforts: [],
    defaultEffort: null,
    priceInPerM: 1,
    priceOutPerM: 5,
    notes:
      'L4 worker loops (lint/format/classify). 200K context. NO effort param (omit), NO adaptive thinking. Mechanical/high-volume work, often batched.',
  },
];

/** Lookup a tier entry by model id. */
export function getTier(modelId: ModelId): ModelTier {
  const tier = MODEL_TIERS.find((t) => t.modelId === modelId);
  // MODEL_TIERS is exhaustive over ModelId; this guard satisfies the type system and
  // protects against a future enum drift.
  if (!tier) throw new Error(`No MODEL_TIERS entry for model id: ${modelId}`);
  return tier;
}

// ─── Knob validation ──────────────────────────────────────────────────────────

/**
 * Validate a set of knobs against the policy for a given model. Returns a list of
 * human-readable violation strings — EMPTY means the pairing is legal. Each rule mirrors
 * a guaranteed-400 from the docs:
 *
 *  - `xhigh` is Opus-4.7+/Fable-only (NOT Sonnet 4.6 — caps at `max`; NOT Haiku).
 *  - the `effort` param errors on Haiku 4.5 — omit it.
 *  - adaptive thinking is Opus 4.6+/Sonnet 4.6/Fable-only — NOT Haiku.
 *  - Opus 4.8 & Fable 5 reject `budget_tokens` and `temperature`/`top_p`/`top_k`.
 *  - Fable 5 rejects `thinking:{type:"disabled"}` — the param must be OMITTED.
 */
export function validateKnobs(modelId: ModelId, knobs: ModelKnobs): string[] {
  const tier = getTier(modelId);
  const violations: string[] = [];

  // effort param legality + rung legality
  if (knobs.effort !== undefined) {
    if (!tier.supportsEffort) {
      violations.push(
        `${modelId}: the \`effort\` param is unsupported and must be omitted (got \`${knobs.effort}\`).`,
      );
    } else if (!tier.allowedEfforts.includes(knobs.effort)) {
      // The headline case: xhigh on Sonnet, or any rung outside this model's set.
      violations.push(
        `${modelId}: effort \`${knobs.effort}\` is not allowed; allowed: [${tier.allowedEfforts.join(', ')}].`,
      );
    }
  }

  // adaptive thinking legality
  if (knobs.adaptiveThinking === true && !tier.supportsAdaptiveThinking) {
    violations.push(`${modelId}: adaptive thinking is unsupported (not allowed on this model).`);
  }

  // Fable: thinking must be OMITTED, never `disabled`.
  if (knobs.thinkingDisabled === true && tier.omitThinkingParam) {
    violations.push(
      `${modelId}: thinking:{type:"disabled"} is rejected — omit the thinking param (always-on thinking).`,
    );
  }

  // Opus 4.8 & Fable 5: depth is controlled by effort only — no budget_tokens / sampling.
  const rejectsBudgetAndSampling =
    modelId === 'claude-opus-4-8' || modelId === 'claude-fable-5';
  if (rejectsBudgetAndSampling) {
    if (knobs.budgetTokens !== undefined) {
      violations.push(
        `${modelId}: \`budget_tokens\` is rejected — control depth with output_config.effort.`,
      );
    }
    if (knobs.sampling === true) {
      violations.push(
        `${modelId}: temperature/top_p/top_k are rejected — control depth with output_config.effort.`,
      );
    }
  }

  return violations;
}

// ─── Escalation stub (Phase 4 enforces precedence) ─────────────────────────────

/**
 * Result of a single escalation bump.
 * `null` `effort` means the effort param is omitted (worker tier).
 */
export interface Escalation {
  readonly modelId: ModelId;
  readonly effort: Effort | null;
}

/**
 * One-tier escalation STUB (data-driven capability bump on repeated grader failure).
 *
 * It bumps effort to the next legal rung within the current model; if already at the
 * model's ceiling, it bumps to the next model tier (worker → executor → judgment →
 * strategy) and resets effort to that tier's default.
 *
 * ⚠️ SUBORDINATE TO BUDGET CAPS. Per the precedence rule (README/TASKS), cost caps and
 * human gates OVERRIDE capability escalation: this bump may NEVER push a loop past its
 * hard cap, and a soft-cap downgrade always wins over an escalation upgrade. This stub
 * does NOT enforce that — the ledger/state-machine clamps the result in Phase 4. Treat
 * the output as a *proposal*, not an applied change.
 */
export function escalateOneTier(modelId: ModelId, effort: Effort | null): Escalation {
  const tier = getTier(modelId);

  // If effort can still climb within this model, climb it (no model change).
  if (effort !== null && tier.supportsEffort) {
    const idx = tier.allowedEfforts.indexOf(effort);
    const next = idx >= 0 ? tier.allowedEfforts[idx + 1] : undefined;
    if (next !== undefined) {
      return { modelId, effort: next };
    }
  }

  // Otherwise step to the next model tier and reset effort to its default.
  const order: readonly ModelRole[] = ['worker', 'executor', 'judgment', 'strategy'];
  const currentRank = order.indexOf(tier.role);
  const nextRole = currentRank >= 0 ? order[currentRank + 1] : undefined;

  if (nextRole === undefined) {
    // Already at the top tier and ceiling effort — nothing left to escalate to.
    return { modelId, effort };
  }

  const nextTier = MODEL_TIERS.find((t) => t.role === nextRole);
  if (!nextTier) return { modelId, effort };

  return { modelId: nextTier.modelId, effort: nextTier.defaultEffort };
}
