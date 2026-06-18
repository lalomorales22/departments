# Runbook — Refusal Storm

A burst of model refusals (`stop_reason: "refusal"`), usually on the Fable-5 path or after
a prompt change that trips the safety classifier.

## Detect

- `RefusalStorm` — ≥3 refusals in 5 minutes (`RefusalStormDetector`,
  `@departments/shared/alerts`).
- Loops stalling at a specific phase with refusal logs; health dipping without a cost cause.

## Why the path is refusal-safe by design

- Fable 5 ships with server-side `fallbacks` (`betas:["server-side-fallback-2026-06-01"]`
  → `claude-opus-4-8`), so a single refusal falls back to Opus instead of killing the tick
  (`callFableSafe` in `@departments/agent-runtime/fable`). A storm means the fallback
  itself is refusing or the input is the problem.

## Diagnose

1. Identify the offending prompt/phase from the logs. Is untrusted content reaching the
   instruction channel? Tool output + web content must be fenced via
   `wrapUntrusted(...)` and treated as DATA — operator instructions belong only on the
   `role:"system"` channel (`@departments/agent-runtime/security`).
2. Check whether a recent `continue-as-new` / prompt edit changed the cached prefix (also
   surfaces as `PromptCacheDegraded`).
3. Confirm the model knobs are legal for the tier (`validateKnobs`) — a 400 can masquerade
   as a stall.

## Recover

- If a specific prompt is the trigger, roll it back or re-fence untrusted content.
- Temporarily pin the affected role off Fable (Fable is behind the cost-approval gate
  anyway — unapproved Fable already downgrades to Opus; see
  [COST_GOVERNANCE](./COST_GOVERNANCE.md)).
- If the fallback is healthy, the loops self-recover as the bad input clears; otherwise
  pause the affected loops and fix the prompt.
