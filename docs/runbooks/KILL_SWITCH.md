# Runbook — Kill Switch

Stop a loop, a subtree, or an entire org immediately. The Commander holds this authority
(`loop.stop` / `loop.pause` capabilities).

## Contain (fastest first)

1. **One loop, from the cockpit** — select it → TransportBar **Pause** (flips to manual
   STEP, halting auto-progression between phases) or stop it. Pause is reversible; no work
   is lost (files-as-memory + the resume cursor make every cycle resumable).
2. **One loop, durable** — signal the Temporal workflow: `terminate`/`pause` on
   `loop-<loopId>` (the `loopWorkflow`). A paused loop rolls its resume cursor back to the
   pre-cycle `HANDOFF.md`, so it re-runs the interrupted cycle rather than skipping it.
3. **A whole subtree (a CEO + its children)** — pause the `ceoWorkflow`, then each child
   `loopWorkflow`. The CEO steers asynchronously, so pausing it stops new objectives; the
   children keep their last objective until individually paused.
4. **Org-wide, hardest stop** — set the org hard cap at/below current spend
   (`BudgetLedger.registerOrg({ hardCapUsd })`): the next `account()` on every loop takes
   the stricter of loop∪org caps and **pauses** them all. This is the cost kill switch.
5. **Platform-wide** — scale the orchestrator Deployment to 0 replicas (`kubectl scale`).
   The WS hub (gateway) can stay up so the cockpit still shows state.

## Verify

- Each target loop emits a `status … loopStatus: paused` event; the cockpit tree turns
  amber. `RunLoopResult.noProgressPaused` / `CycleResult.paused` reflect the stop.
- No new `Run` rows append for the stopped loops.
- Irreversible tools cannot fire while paused (the `always_ask` gate only runs inside a
  live phase).

## Recover

Resume from the cockpit (Run) or re-signal the workflow. Because MEMORY is the only legal
handoff and the resume cursor was rolled back on pause, the loop continues exactly where it
left off — no double-execution, no dropped insight.
