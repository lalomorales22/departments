# Runbook — Runaway Loop

A loop spins without progress, spends too fast, or tries to spawn unboundedly. Most of
this is caught automatically; this runbook is for when you need to intervene or tune.

## Detect

- `LoopNoProgressPaused` — the no-progress detector auto-paused after *H* (default 3)
  cycles with no meaningful diff (excludes `HANDOFF.md`/timestamp churn) and no metric
  movement. `alert.kind = 'no_progress_pause'`.
- `OrgBudgetHardCapBreached` / soft-cap downgrade — cost guardrail.
- `GateBarrierSustained` — health < 50% for 30m (gates failing repeatedly).
- Spawn denials in the log (`spawn denied: …`) — the denial-loop guard blocking retries.

## Why it usually self-heals (the guardrails)

- **No-progress detector** drops health + auto-pauses a stuck loop.
- **Cadence floors** reject ticks faster than the tier allows (a continuous loop can't
  hot-spin).
- **Concurrency semaphore** bounds simultaneous sessions per org.
- **Budget caps** (loop ∪ org, stricter wins): soft → downgrade effort, hard → pause.
- **Escalation is subordinate to caps** — a capability bump is refused under any non-`ok`
  cap or insufficient hard-cap headroom.
- **Spawn controller** enforces max depth, per-org child cap, queued-spawn cap, and blocks
  re-requesting a denied `(parent, child)`.

## Diagnose

1. Open the loop's HISTORY + LogConsole. Look for repeated `gate barrier`, `escalation
   refused`, `cadence floor`, or `no-progress detector` lines.
2. Check `caching_audit` (0006) — a cold cache inflates cost per tick (see
   [COST_GOVERNANCE](./COST_GOVERNANCE.md)).
3. Inspect the artifact diff: is the loop rewriting the same file each cycle (churn)? The
   detector already discounts `HANDOFF.md`; widen `exclusionPatterns` if a new ephemeral
   file is defeating it.

## Recover / tune

- Leave it paused and fix the root cause (a bad task in `TASKS.md`, an unreachable goal).
- Lower the loop's `budgetCapUsd` or the org cap to throttle.
- Tighten the cadence tier (e.g. `continuous` → `hourly`).
- If a gate is mis-calibrated, adjust thresholds in SETTINGS → Gate Thresholds (Commander).
- Re-run only after a real fix — resuming an unchanged stuck loop just re-trips the detector.
