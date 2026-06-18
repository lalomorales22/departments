# Runbook — Cost Governance

Keep spend safe and cheap. The order of saving is fixed and tracked:
**caching → tiering → batching → effort.**

## Detect

- `OrgBudgetHardCapBreached` (loops paused) / soft-cap downgrade.
- `PromptCacheDegraded` — `cache_read_ratio` ~0 across recent ticks (the #1 lever lost).
- `fable_approval_required` alerts — the gated Fable path was requested.

## The per-org budget dashboard

- Cockpit → SETTINGS → **Billing & Limits**: org spend vs hard cap, soft-cap (80%) tick,
  per-loop allocation (top spenders). Backed by `BudgetLedger.orgReport(orgId)` in prod.
- SQL: `caching_audit` (per-run hit ratio) + `gate_pass_daily` (health over time), both
  RLS-scoped (`0006_audit.sql`).

## Levers, in order of impact

1. **Caching (≈0.1× reads).** If `PromptCacheDegraded` fires: a prefix invalidator crept
   in (a timestamp/UUID, unsorted JSON, a varying tool set) — almost always after a
   `continue-as-new` or prompt edit. `CacheAuditor` flags MID-LIFE degradation (warm → cold)
   specifically. Fix the prefix; pre-warm scheduled CEO reviews (`max_tokens:0`).
2. **Tiering.** Mechanical work on Haiku (no effort param), volume execution on Sonnet,
   judgment on Opus. A naive "everything on Opus" costs ~5×. The locked per-route efforts
   live in `LOCKED_ROLE_EFFORT` (`@departments/agent-runtime/models`).
3. **Batching (50% off).** CEO sweeps + bulk classify/lint/summarize go through the Batch
   API (`batchSavings` quantifies it). Never for interactive EXECUTE.
4. **Effort.** Swept per route and locked: workers none, executors `medium`/`high`,
   judgment `high`/`xhigh`.

## Fable-5 gate

Fable ($10/$50 — 2× Opus) is reserved for quarterly strategy / greenfield and is behind
**explicit cost approval**. An unapproved Fable role auto-downgrades to Opus and raises
`fable_approval_required` (`requiresFableApproval`); approve only with a budget reason
(`spec.fableApproved` / the Commander `fable.approve` capability).

## Tune the caps

- Soft cap = 80% of hard by default (`DEFAULT_SOFT_CAP_FRACTION`). Adjust per loop
  (`registerLoop`) or per org (`registerOrg`). Remember: an unregistered org cap means
  **uncapped** (`orgStatus` → `ok`), not "paused" — register a real cap to make it bite.
- Recovery from a hard-cap pause: raise the cap (with justification) or let the cycle
  re-run after the period resets; the loop resumes from `HANDOFF.md`.
