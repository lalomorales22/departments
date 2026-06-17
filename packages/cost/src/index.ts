/**
 * @departments/cost — caching helpers, batch/token pre-checks, and the budget
 * ledger.
 *
 * Cost discipline is structural for a loop that "re-runs constantly" (see
 * README → Cost control). This package owns the four levers' *math + signals*:
 * prompt caching (#1 lever), model tiering (the price table), and `count_tokens`
 * pre-checks, plus the per-loop / per-org budget ledger (soft cap → downgrade,
 * hard cap → pause).
 *
 * Phase 1 = typed no-ops where enforcement belongs to later phases; the ledger
 * math is real and tested now. The precedence rule (caps override escalation) is
 * enforced by the engine in Phase 4 — this package only emits the signals.
 */
export * from './ledger.js';
export * from './caching.js';
export * from './count-tokens.js';
