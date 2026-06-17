# ◈ DEPARTMENTS — HANDOFF

> The cross-cycle memory of this repo's own `loop software-builder`. **MEMORY is the only legal handoff between cycles** — the next PLAN reads this first. Keep it truthful and current.

- **Cycle:** 3 (Phase 3 — The Live Dashboard)
- **Updated:** 2026-06-17
- **Status:** ✅ Phase 1 (Foundations) + Phase 2 (The Loop Engine) + Phase 3 (The Live Dashboard) complete. The cockpit is now **driven by a real loop over a reconnect-safe realtime spine** — pipeline, agents, metrics, health, logs, inspector, and connection state all bind live. The **no-progress detector** and **manual single-step** are live. Real Redis/WS/Postgres paths are authored and gated behind creds + Docker.

---

## Phase 3 — what shipped

### The realtime spine — `packages/realtime` (new, fully tested)
- **`EventStream` port** abstracting Redis Streams ops (append / replay-after-cursor / subscribe-tail / `lastSeq`) behind one interface, with **two adapters shipped from day one** (the proven `FakeCmaRuntime`/`CmaRuntime` + `InMemory`/`PgVector` pattern):
  - `InMemoryEventStream` — works with **zero infra**; the cockpit's default.
  - `RedisEventStream` — **gated on `REDIS_URL`**, authored against an INJECTED minimal `RedisLike` client (no `ioredis` import), unit-tested with a fake client. Not run here.
- **`lastSeq()` makes the per-loop `seq` allocator PERSISTENT** — the structural fix for resume-after-restart (the old in-process Map reset to 0 every process).
- **`ingest()` / `ResumeState`** — the pure resume-by-`seq` + dedupe-by-`id` + always-settle core (`status|metric|error` re-settle even if seen; no duplicate log lines). The single tested source of truth, shared by the browser store and the WS gateway.
- **`topicsFor()`** — maps a `DeptEvent` to the frozen WS topics; **`ReconnectController` + `backoffDelay`** — transport-agnostic backoff + heartbeat/stale state machine. **30 unit tests.**

### Engine integration — `packages/orchestration`
- **No-progress detector** (`NoProgressDetector`, pure + tested): consumes `ArtifactSnapshot.meaningful` (already excludes the always-rewritten `HANDOFF.md`) **AND** metric movement; `H` consecutive stalls → health drop + **auto-pause + alert**, threaded across cycles in `local-driver`. Emits a live `health` metric every cycle. **Budget cap / human gates still take precedence** (checked first).
- **Manual single-step** (`StepGate` / `ManualStepGate`): the engine `await`s a gate before every phase; `autoStepGate` (default) is a no-op. CLI `--step` reads stdin; the web `/step` route writes a newline to the engine subprocess.
- **`StreamPersistence`** — a `PersistencePort` that tees the engine feed into an `EventStream` with the seq seeded from `lastSeq` (the engine→Redis-direct production path). CLI gained `--step` and `--stall` (demos the no-progress pause).

### Web transport — `apps/web` (the LOCAL transport)
- **Decoupled run from watch.** `POST /run` spawns the engine and pipes its NDJSON into a **process-global server-side `EventStream`** (re-stamping the AUTHORITATIVE per-loop seq so it's monotonic across runs); the run is no longer the client's event source.
- **`GET /stream` (SSE)** — the reconnect-safe feed: replays after `?lastSeq`/`Last-Event-ID`, tails live, `id:` = seq, heartbeats. SSE is the browser transport for `next dev` (no extra server; native `Last-Event-ID` resume). `POST /step` advances a step-mode run; `GET /inspect` reads the loop's real git workspace + memory.
- **`lib/realtime.ts`** rewritten: one multiplexed SSE subscription per loop, per-loop `lastSeq`, seen-id dedupe, exponential-backoff reconnect, heartbeat/stale, derived `activePhase`/`runStatus`. **`lib/live.ts`** — live-or-fixture hooks every organism reads through.

### The cockpit, alive
- **LoopPipeline** (live `activePhase`/stages/cycle + AUTO↔STEP toggle + STEP advance), **AgentGrid** (live role-driven statuses), **MetricGrid/Card** (live engine metrics, LIVE/MOCK badge, delta-flash), **LoopHeader** (live cycle/health/status), **HealthGauge** (live health), **StatusBar** (REAL connection state — `LIVE`/`RECONNECTING`/`STALE`, live clock; the fake `LIVE·MOCK` + frozen clock are gone), **TransportBar** (real Run/Pause→step/Step), **LogConsole** (`aria-live`, autoscroll-lock + "↓ N new" pill), **Inspector** (real ARTIFACTS rows + memory + per-run **Run Trace** in HISTORY), **Kanban** (optimistic + keyboard moves + live counts).

### Normalizer + observability + gateway
- **Full `CmaSseNormalizer`**: added `message_delta` (streaming), `custom/server_tool_use`, `*_tool_result` (result/error phases), and per-gate verdicts on `outcome_evaluation_end`. **+ a new normalizer test suite (8) and the events package's first tests (4).**
- **Observability:** per-run **Run Trace** (phase timeline + grader + guardrail, from the event feed) in the Inspector; opt-in structured server log keyed by `org/loop/run/seq` (`DEPT_TRACE`).
- **NestJS WS gateway** (`apps/gateway` `RealtimeModule` + `RealtimeGateway`, `WsAdapter`): subscribes the per-loop `EventStream`, multiplexes onto the frozen topics, replays-by-seq, heartbeats. The **production transport over the same spine** — typechecked + wired, run only with Redis (Docker). Added the `metric UNIQUE(loop_id, key)` migration (idempotent metric upserts; `event` already had `UNIQUE(loop_id, seq)`).

## Verification (this machine, no Docker / no CMA creds)
- **13/13 packages typecheck**; **`next build` + `next lint` clean**; **195 unit tests pass (+1 skipped Fable smoke)** across 10 test tasks — `pnpm test` is fully green (fixed the orchestrator "no test files" wart with `--passWithNoTests`).
- **End-to-end through the cockpit's HTTP layer:** a real loop streams over SSE; **resume from a mid-cursor returns only `seq > cursor` with zero duplicates**; a `--stall` run **auto-pauses** (health 80→60→40, one `paused` status, the guardrail log) over the SSE spine; **manual single-step** holds at each phase until `POST /step` (2 events → 31 after 4 steps; `409` on an idle loop); `/inspect` returns the loop's **real artifacts** (README/TASKS/STRATEGY/REPORT/HANDOFF + `src/generated/*.ts`), distilled memory, and HANDOFF.

## Known gaps / explicitly deferred
- **No Docker here:** `RedisEventStream`, the NestJS WS gateway, Postgres upserts, and Temporal are authored + typechecked but exercised only under `docker compose up -d`. The local cockpit uses `InMemoryEventStream` + SSE (a real, reconnect-safe transport — the WS gateway speaks the same protocol).
- **Kanban is fixture-seeded with optimistic local moves** — there is no `task` kind in the frozen `Event` protocol, so true live task state needs a separate **tasks projection** (a patch channel, not a `DeptEvent`). Deferred — do NOT bump `EVENT_PROTOCOL_VERSION` for it.
- **LogConsole** stayed a DOM list (got `aria-live` + autoscroll-lock + "↓ N new"); xterm.js virtualization is unneeded at current event volume — deferred polish.
- `/inspect` reads the local git workspace directly (no org/RLS scoping); the production read path is the gateway + RLS (Phase 4/5).
- `.volumes/` (per-loop git repos + memory JSONL + test loops like `p3*`) is gitignored — runtime state, never committed.

## Next PLAN should start here (Phase 4 — Hierarchy & Meta-Loop)
1. **Child-loop spawning** behind a manual-approval gate (max depth, per-org cap, denial-loop guard) + health/metric **rollup** into parents; `LoopTree` shows real nesting.
2. **`CeoWorkflow`**: async steer (read children's last persisted state, never block), `set_objective`, **Batch API** review (50% off, shared cached prefix), pre-warm.
3. **Turn on the runaway guards where autonomy scales:** concurrency semaphore (Redis), cadence floors, the **org-wide hard budget cap**, and **`always_ask` on irreversible tools** — plus the **budget-vs-escalation precedence in the ledger/state machine**.
4. Scheduling (Temporal timers + CMA Scheduled Deployments + HMAC webhook → `run_now`); ANALYTICS tab on cross-loop rollup views; ARTIFACTS tab (⌘I import).

## Watch-outs
- The **frozen `Event` protocol** (`EVENT_PROTOCOL_VERSION = 1`) is binding — new signals (health, step, no-progress) reuse EXISTING kinds. Adding a `task` kind = a protocol bump; route task state through a patch channel instead.
- **Seq ownership:** the engine's per-process seq is PROVISIONAL; the durable store (server-side in-mem / Redis) re-stamps the AUTHORITATIVE per-loop seq on append. Resume keys off the stored seq; dedupe keys off the stable `id` (survives re-stamping). Keep `lastSeq` the single seq source.
- `@departments/realtime` uses **extensionless relative imports** (it's webpack-transpiled by Next, like `shared`/`events`) — do NOT add `.js` extensions there (they break the Next build); the tsx-run packages keep `.js`.
- The browser SSE transport is interchangeable with the WS gateway by protocol — both honor resume-by-`seq` + dedupe + always-settle. Don't let either drift from the `@departments/realtime` core.
- No-progress / step pauses must never override a budget-cap pause or a human gate (precedence: caps + gates win).
