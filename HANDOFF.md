# ◈ DEPARTMENTS — HANDOFF

> The cross-cycle memory of this repo's own `loop software-builder`. **MEMORY is the only legal handoff between cycles** — the next PLAN reads this first. Keep it truthful and current.

- **Cycle:** 2 (Phase 2 — The Loop Engine)
- **Updated:** 2026-06-17
- **Status:** ✅ Phase 1 (Foundations) + Phase 2 (The Loop Engine) complete. A single loop runs a **full real cycle** locally; the cockpit can trigger one live. Real CMA / Temporal / pgvector paths are authored and gated behind creds + Docker.

---

## Phase 2 — what shipped

### The engine (`packages/orchestration`) — the core, fully tested
- `runCycle()` drives **PLAN → EXECUTE ⇄ EVALUATE (bounded rework) → IMPROVE → MEMORY** over hexagonal **ports** (`ArtifactPort`, `MemoryPort`, `RubricPort`, `LedgerPort`, `PersistencePort`, `Clock`) so the cycle logic is pure and swappable.
- `state-machine.ts` — gate routing (`routeEvaluate`: fail → rework, bounded by `maxIterations`; settle → proceed), cycle advance/wrap. `bootstrap.ts` — resumable (HANDOFF → resume next cycle; else seed). `local-driver.ts` — composition root wiring the real adapters. `cli.ts` — `tsx src/cli.ts <loop> [--cycles N] [--stream]` (NDJSON in `--stream`).
- **Budget-cap PRECEDENCE enforced in the engine:** hard cap → PAUSE, soft cap → DOWNGRADE effort — both override escalation. Per-loop monotonic event `seq`; one `Run` per phase (audit spine).

### The runtime boundary (`packages/agent-runtime`)
- `LoopAgentRuntime` — the engine-facing contract (startSession / executePhase / evaluate / endSession).
- `FakeCmaRuntime` — deterministic, local, network-free; writes real files into the loop's git tree, streams the full event feed, fails the performance gate on the first grade (so IMPROVE always iterates), simulates prompt-cache warmth on cycle > 1.
- `CmaRuntime` + `CmaSseNormalizer` + `callFableSafe` — the REAL adapter (against an injected `CmaClient`, no SDK hard-dep), the partial SSE→Event normalizer, and the Fable-5 refusal-safe path (server-side fallback → `claude-opus-4-8`, 30-day retention). `validateKnobs` enforced before provider calls. A live Fable smoke test ships **skipped unless `ANTHROPIC_API_KEY`**.

### Infra adapters
- `packages/artifacts` — **real git-backed** `GitArtifactStore`: per-loop ISOLATED repo at `.volumes/loops/<id>`, seed README/TASKS/HANDOFF, snapshot+tag each phase (`loopId/runId/phase`), `meaningful` diff excludes HANDOFF.md (no-progress guardrail). *(Fixed a real bug: it now checks for a local `.git` rather than `--is-inside-work-tree`, so loop commits never leak into the monorepo.)*
- `packages/memory` — `InMemoryMemoryStore` / `FileMemoryStore` (deterministic local embedding + cosine recall) + `PgVectorMemoryStore` (gated behind `DATABASE_URL`).
- `packages/rubrics` — the four gates as gradeable criteria + `gradeSignals` heuristic (the authoritative grader is the independent CMA Outcome).
- `apps/orchestrator` — Temporal `loopWorkflow` (continue-as-new, `runNow`/`pause` signals) + idempotent `runCycleActivity` + worker; `main.ts` degrades gracefully without Temporal. **Authored + typechecked; not runnable here (no Docker).**
- `scripts/` — `provision-agents.yaml` (per-role Agent templates with the exact model tiering) + `provision.ts` (validates every `(model,knob)` via `validateKnobs`, dry-run by default).

### Frontend (minimal run-a-loop)
- `app/api/loops/[id]/run/route.ts` — spawns the engine CLI as a subprocess and streams NDJSON (decouples Node-only engine from webpack). `lib/realtime.ts` — streaming store. `LogConsole` merges live events; `CommandBar` `run <name>` / ▶ trigger; `?run` deep-link auto-runs.

## Verification (this machine, no Docker / no CMA creds)
- **All 12 packages/apps typecheck**; `next build` + `next lint` clean; **139 unit tests pass** (+1 skipped Fable smoke).
- **Real end-to-end cycle proven:** `loop software-builder --cycles 2` produced an isolated git repo with per-phase commits/tags (`seed → c1:plan → c1:execute → c1:execute:rework1 → c1:improve → c1:memory → c2:…`), IMPROVE rework, MEMORY → HANDOFF (`Cycle: 2`), resume, and a **63% cost drop on the warm cycle** (cacheRead 0 → 13,916).
- **Cockpit-triggered run works:** `POST /api/loops/:id/run` streams the real engine into the LogConsole live.

## Known gaps / explicitly deferred
- Temporal/Postgres/Redis/MinIO not run (no Docker). `docker compose up -d && pnpm db:migrate` is the next manual check; the Temporal workflow + pgvector memory are authored but unexercised.
- Real CMA + Fable calls need `ANTHROPIC_API_KEY` + the `managed-agents-2026-04-01` beta; the adapter is DI-tested with a fake client.
- Live pipeline-stage advance from streamed events, the full reconnect-safe WS spine, and the no-progress detector are **Phase 3**.
- `.volumes/` (per-loop git repos + memory JSONL) is gitignored — runtime state, never committed.

## Next PLAN should start here (Phase 3 — The Live Dashboard)
1. Full CMA-SSE→Event normalizer + Redis Streams + WS gateway (resume-by-`seq`, dedupe-by-`id`, backpressure, heartbeats).
2. Realtime store → single multiplexed WS; pipeline advances from `status` events; agent grid / kanban / metrics bind live.
3. The **no-progress detector** (H cycles, no meaningful diff/metric → health drop → auto-pause) — the `meaningful` signal already lands from `GitArtifactStore`.
4. Per-run trace view; structured logging keyed by `org/loop/run/seq`.

## Watch-outs
- Keep the engine talking ONLY to `LoopAgentRuntime` + the ports — no direct model/SDK calls in `orchestration`.
- `GitArtifactStore` must keep checking for a LOCAL `.git` (isolation); never let loop commits touch the monorepo.
- Temporal workflow code must stay deterministic (no `Date.now`/`Math.random`/IO in `workflows.ts`).
- Budget caps + human gates override escalation — never let an escalation bump breach a hard cap.
