# ◈ DEPARTMENTS — Build Plan (`TASKS.md`)

> **Mission of this plan:** Ship Departments — the `loop <anything>` orchestration platform — in **five demoable, de‑risking phases**. Each phase produces something runnable; each de‑risks the next. The single hardest piece (a secure, stateful, file‑capable agent sandbox with streaming + caching + compaction) is bought from **Anthropic Managed Agents (CMA)**; we own orchestration, real‑time, product, and cost control.
>
> See [`README.md`](./README.md) for the product, architecture, and canonical vocabulary. This file is the loop's `TASKS.md` artifact.

---

## Authoritative model facts (do not "correct" from memory)

| Role | Model | ID | Context | Thinking | Effort | $/1M in · out |
|---|---|---|---|---|---|---|
| CEO meta‑loop / Planner / Reviewer‑grader | Claude Opus 4.8 | `claude-opus-4-8` | 1M | adaptive | `high` (default), `xhigh` hard agentic | $5 · $25 |
| Hardest CEO / greenfield strategy (gated) | Claude Fable 5 | `claude-fable-5` | 1M | always‑on (omit param) | `xhigh`/`max` | $10 · $50 |
| Executor agents (dev/content/SEO/analyst) | Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | adaptive | `medium`→`high` (ceiling `max`) | $3 · $15 |
| L4 worker loops (lint/format/classify) | Claude Haiku 4.5 | `claude-haiku-4-5` | **200K** | none | **none** | $1 · $5 |

**Knob rules (each wrong pairing is a 400):** `xhigh` is Opus‑4.7+/Fable‑only (not Sonnet 4.6 — caps at `max`; not Haiku). The `effort` param **errors on Haiku 4.5** — omit it. Adaptive thinking is Opus 4.6+/Sonnet 4.6/Fable‑only — **not Haiku**. Opus 4.8 & Fable 5: no `budget_tokens`, no `temperature`/`top_p`/`top_k`. Fable 5: never `thinking:{type:"disabled"}` — omit; requires server‑side `fallbacks` (`betas:["server-side-fallback-2026-06-01"]` → `claude-opus-4-8`) + 30‑day retention.

**Cost levers, in order of impact:** prompt caching (≈0.1× reads) → model tiering → Batch API (50% off) → effort tuning.

**Canonical pipeline:** engine phase `improve` == UI stage `OPTIMIZE` (same stage). Colors: PLAN cyan, EXECUTE green, EVALUATE purple, OPTIMIZE amber, MEMORY blue. Bind everything to this once.

---

## Cross‑cutting guardrails (established in Phase 1, tightened each phase)

Because a loop "re‑runs constantly," cost and runaway control are **structural** — seeded as scaffolding in Phase 1, not bolted on at the end.

- **Budget ledger** (per‑loop + per‑org) from `span.model_request_end.model_usage` / Messages `usage`. Soft cap → auto‑downgrade effort/model; hard cap → pause + alert. *Stubbed P1 → enforced P2 → **org‑wide hard cap enforced P4** → tuned P5.*
- **Precedence rule:** **cost caps and human gates OVERRIDE autonomy and capability escalation.** The grader‑failure escalation bump may never push a loop past its hard cap; soft‑cap downgrade wins over escalation upgrade. *(Engine task in P4, not prose.)*
- **Cadence floor + concurrency semaphore** (Redis). *Stubbed P1 → enforced P4.*
- **No‑progress detector:** *H* consecutive cycles with no **meaningful** artifact delta and no metric movement → health drop → auto‑pause. **"Meaningful" excludes the always‑written `HANDOFF.md` and timestamp churn** (else the detector is defeated by design). *Lands P3.*
- **No self‑grading:** EVALUATE grader runs in an independent CMA Outcome context (Opus 4.8); agents can't pass their own Alignment/Risk gate. *Lands P2.*
- **`always_ask` on irreversible tools** (deploy/send/spend/delete). *Configured P2 → **enforced P4** (with autonomy/hierarchy), tuned P5.*
- **Prompt‑cache discipline from day one:** frozen system prompts, deterministic tool order, volatile per‑tick context via mid‑conversation `role:"system"` — the runtime is *cache‑shaped* before there's any spend to optimize.

---

## Phase 1 — Foundations

**Goal.** Stand up the monorepo, design system, three‑column mission‑control shell, full data model + RLS, auth/RBAC, and a mock event pipeline — so the product is navigable and demoable against fixtures, with the cost‑ledger and cache seams already cut and the `Event` protocol frozen.

**Deliverables.** Turborepo monorepo; token‑driven dark design system + component skeletons; the app shell; Postgres schema + RLS; auth + RBAC roles; mock realtime over WS; the frozen unified `Event` protocol package.

### Frontend
- [ ] Scaffold `apps/web` (Next.js App Router + TS + Tailwind + Zustand + TanStack Query).
- [ ] Define `:root` tokens (`--bg/surface/border/text/accent/glow-*`, radii, spacing, elevation); centralize one `statusTheme` map — **no inlined hex anywhere**.
- [ ] Self‑host Geist + Geist Mono; wire `--font-sans`/`--font-mono`; `tabular-nums` for all metrics.
- [ ] Atoms: `StatusBadge/StatusDot`, `Kbd`, `TagChip`, `PriorityBadge`, `DeltaChip` (with `goodDirection`), `SectionLabel`, `TimerDisplay`.
- [ ] App‑shell organisms: `AppBar` (logo, TabNav, CommandSearch, TransportBar), `StatusBar`, collapsible left/right columns (`[`/`]`, drag‑resize, persisted).
- [ ] `LoopTree` (CEO/Business/Execution/Worker groups, recursive `LoopTreeNode`, status dots, kebab) + `QuickActionList`, against fixtures.
- [ ] `InspectorPanel` shell (DETAILS/CONFIG/HISTORY) bound to the fixture loop.
- [ ] `:focus-visible` cyan ring; `prefers-reduced-motion` + `prefers-reduced-data` paths; skip‑to‑content.
- [ ] **Command palette (cmdk) + the full keyboard chord set** wired to navigation: ⌘K search, ⌘P palette/run‑loop, ⌘D debug, ⌘F find, ⌘E explorer/tree, ⌘M map, `?` ShortcutSheet, `1`–`6` tabs, `[`/`]` panels. (Map/Explorer focus targets exist even if their panels are stubs.)

### Backend / engine
- [ ] Scaffold `apps/gateway` (NestJS): auth middleware, RBAC guards, GraphQL+REST skeleton, WS hub.
- [ ] Scaffold `apps/orchestrator` (Temporal worker host) — empty workflow stubs only.
- [ ] **Freeze `packages/events`** as the binding contract: `kind` enum (`log|debug|output|agent_msg|tool_use|status|metric|error`), **monotonic `seq` per loop**, **stable event `id` for dedupe**, `loop_id`, and the `(loop_id, seq)` resume cursor. Define (but don't implement) the CMA‑SSE→Event normalizer interface.
- [ ] Mock event source: gateway replays fixture streams per `loop:{id}` channel over WS with `seq`.

### AI
- [ ] `packages/agent-runtime` **interface only**: `startSession / sendEvents / streamEvents / defineOutcome` (CMA‑vs‑self‑hosted abstraction).
- [ ] `packages/agent-runtime/models`: encode the exact model‑tier + effort policy table (IDs/effort above) + escalation‑rule stubs.
- [ ] **CI assertion (now):** the policy table can never pair an unsupported `(model, knob)` — reject `Haiku+effort`, `Haiku+adaptive`, `Sonnet-4.6+xhigh`, `Fable+thinking-disabled`.
- [ ] `packages/cost` skeleton: `recordUsage()`, `BudgetLedger` (per‑loop/per‑org rows), `count_tokens` wrapper signature — typed no‑ops.

### Data
- [ ] Author the Postgres schema: `Org, User, Loop, Agent, Subagent, Task, Run, Event, Metric, Memory(+pgvector), Artifact, ArtifactVersion, Outcome, Rubric, Vault`.
- [ ] Self‑referential `Loop.parent_loop_id` (the L1–L4 tree); enums (`level`, `status`, `role` incl. `coordinator`, `area`, `priority`, `phase` incl. `improve`).
- [ ] Enable pgvector; add `Memory.embedding` column + index (unused yet).
- [ ] **RLS policies:** deny cross‑`org_id` reads/writes on every tenant table; policy tests are a CI gate from the first migration.
- [ ] **Seed fixtures mirroring the UI spec exactly**, with a **coherent recent `CREATED` date** (current era — not "May 2024"): the `marketing` loop; 8 agents with the right running/idle split (Market Researcher, Content Strategist, SEO Specialist, Campaign Manager, Data Analyst = running; Copywriter, Graphic Designer, Performance Reviewer = idle); kanban 5/4/2/4; the six metric cards **with `goodDirection`** (Bounce Rate down = green); five artifacts; five memory items.

### Infra
- [ ] Docker Compose dev stack: Postgres(+pgvector), Redis, Temporal, MinIO (S3/R2 stand‑in).
- [ ] K8s manifest skeletons (gateway/orchestrator/web).
- [ ] CI: typecheck, lint, unit, **RLS policy test**, **`(model,knob)` policy test**, build all packages.
- [ ] KMS placeholder; document that agent‑facing creds will live in CMA Vaults.

**Acceptance — done when:** a Commander logs in, sees `marketing` in the tree, clicks it, and center + inspector bind to live‑looking fixture data (logs streaming, sparklines animating, kanban populated); RLS tests prove org‑2 can't read org‑1; all shortcuts/tabs/panels work; reduced‑motion/data verified; design QA passes the "rationed neon, hairline panels, mono machine‑values, glow only on live/selected" checklist.

**Demo.** Click‑through of the full cockpit against mock data — looks live, nothing real behind it.

**Risks.** Design slipping into generic AI‑SaaS slop → enforce the anti‑pattern list in QA. Event‑schema churn later → it's frozen now. RLS gaps → CI gate from migration #1.

---

## Phase 2 — The Loop Engine

**Goal.** Make a single loop *actually run* one full PLAN→EXECUTE→EVALUATE→IMPROVE→MEMORY cycle on real CMA, with the canonical roster, real artifacts (files‑as‑memory in a per‑loop Git repo), model tiering + caching, and EVALUATE as an independent Outcome.

**Deliverables.** `LoopWorkflow(loopId)` durable workflow (single loop, run‑on‑demand); real CMA integration (one Agent template per role, Sessions per run, Git‑mounted container); the bootstrap sequence inside a session; the five‑agent coordinator + subagent fan‑out; EVALUATE/IMPROVE via Outcome; MEMORY to memory store + Postgres/S3 + pgvector; cost levers live.

### Backend / engine
- [ ] `LoopWorkflow` with **continue‑as‑new** every *N* cycles (carry compact state: phase, ledger, child handles, last `HANDOFF` pointer).
- [ ] State‑machine package: PLAN/EXECUTE/EVALUATE/IMPROVE/MEMORY transitions + gate routing (fail → back to EXECUTE).
- [ ] Activities (session lifecycle, artifact snapshot, persistence writes, ledger update) — **idempotent on `runId`**; replayed tick reattaches to the in‑flight session (no double‑start).
- [ ] `run_now` signal; persist one `Run` per `(loop, phase, tick)` as the audit spine.
- [ ] **Partial CMA‑SSE→Event normalizer slice** sufficient for raw phase progression in the LogConsole (so Phase 2's frontend task doesn't silently depend on Phase 3's full normalizer).

### AI
- [ ] One‑time provisioning script (`ant` YAML) for role Agents: Planner (Opus 4.8 `high`), Executor (Sonnet 4.6 `medium`→`high`), QA, Docs, Reviewer/grader (Opus 4.8 `high`). Store agent IDs + versions in config — **never in the request path**.
- [ ] Implement `agent-runtime/cma`: the four interface methods against `client.beta.{agents,sessions}.*` with `managed-agents-2026-04-01`.
- [ ] Coordinator roster on the planner (`multiagent:{type:"coordinator", agents:[executor,qa,docs,reviewer]}`); executors fan out to subagent threads.
- [ ] `packages/rubrics`: quality / data‑validation / alignment‑risk / performance as gradeable Markdown criteria.
- [ ] Wire EVALUATE → `user.define_outcome` (rubric + `max_iterations`); map `span.outcome_evaluation_*` (`satisfied`/`needs_revision`/`max_iterations_reached`/`failed`) to gate verdicts. IMPROVE = the iterate→grade→revise loop.
- [ ] Apply the **corrected** model knobs: adaptive on Opus/Sonnet; effort per role; **omit effort and adaptive on Haiku**; no `budget_tokens`/sampling params on Opus/Fable.
- [ ] **Fable 5 refusal‑safe path + a minimal Fable smoke test now** (a single real `claude-fable-5` call with `fallbacks:[{model:"claude-opus-4-8"}]` + `server-side-fallback-2026-06-01` and `stop_reason:"refusal"` handling) — so the path ships *tested*, not unexercised until Phase 4.

### Data / artifacts
- [ ] `packages/artifacts`: provision a per‑loop Git repo, mount via CMA `github_repository` at `/workspace`; seed `README/TASKS/HANDOFF` on cold start.
- [ ] Snapshot changed artifacts after each phase: new `ArtifactVersion` (git SHA + S3 blob); tag commits `loopId:runId:phase`.
- [ ] `packages/memory`: sync CMA memory store ↔ Postgres `Memory` + pgvector embeddings; PLAN reads `HANDOFF` + queries memory first.

### Cost (first hardening point)
- [ ] Prompt caching: `cache_control` on the last stable block (tools→system→shared README/brand context); volatile per‑tick task via mid‑conversation `role:"system"`. **CI assert `cache_read_input_tokens > 0` across ticks of the same loop.**
- [ ] Budget‑ledger enforcement: record `model_usage` per Run; soft cap → downgrade; hard cap → pause + alert.
- [ ] `count_tokens` pre‑check before any large submission.

### Frontend
- [ ] Minimal "run a loop" trigger from the command bar (fires `run_now`); show raw phase progression in the LogConsole via the partial normalizer.

**Acceptance — done when:** `loop software-builder` (cold start) asks the mission, scaffolds `README/TASKS/HANDOFF`, runs one full cycle, the Executor produces a **real artifact diff** in Git, the independent Opus 4.8 grader passes/fails the four gates, IMPROVE iterates on a failed gate, and MEMORY writes `HANDOFF` + a distilled memory entry the *next* PLAN reads. Re‑running **resumes** from `HANDOFF.md`. `cache_read_input_tokens` is non‑zero on tick 2+; a forced over‑budget run auto‑pauses. *(Note: cost‑breach pausing exists now, but spinning‑within‑budget isn't caught until the Phase 3 no‑progress detector — accepted.)*

**Demo.** A real loop completes one cycle; `cat` the resulting `HANDOFF.md`/`REPORT.md`; the grader's gate verdicts are visible.

**Dependencies.** Phase 1 (schema, frozen `Event` protocol, runtime interface, models policy, cost skeleton).

**Risks.** Hallucinated "done" → grader scores artifacts (diffs), not claims; engine cross‑checks Outcome `result` + diff before marking `done`. Cache silently not hitting → alert on ~0 reads. Orphaned CMA agents → created once, referenced by ID; sessions archived on stop.

---

## Phase 3 — The Live Dashboard  ✅ SHIPPED (Cycle 3, 2026-06-17)

> **Status:** complete. The cockpit binds to a real loop over the reconnect‑safe spine (`@departments/realtime` `EventStream` → SSE locally / NestJS WS gateway in prod, resume‑by‑`seq` + dedupe‑by‑`id` + always‑settle). The no‑progress detector + manual single‑step are live. Redis/WS/Postgres paths are authored + gated behind Docker. See [`HANDOFF.md`](./HANDOFF.md) for the full Cycle‑3 record. The remaining checklist items below are kept for provenance (Kanban live task state needs a tasks projection outside the frozen `Event` protocol; xterm virtualization deferred).

**Goal.** Wire the full cockpit to a *real* running loop: terminal/logs, agent statuses, pipeline, kanban, real‑time metrics, and inspector all update live over a reconnect‑safe **CMA‑SSE → normalizer → Redis Streams → WS → UI** spine, plus the no‑progress detector.

**Deliverables.** The full real‑time spine; a reconnection‑safe client (resume‑by‑`seq`, dedupe‑by‑`id`, backpressure, heartbeats); all center/right organisms bound to live data; per‑run traces + structured logging; the live no‑progress detector.

### Backend / real‑time
- [ ] **Full** CMA‑SSE→Event normalizer: `agent.message/thinking`→OUTPUT/LOGS; `agent.tool_use/mcp_tool_use`→DEBUG; `session.status_*`/`thread_status_*`→agent status; `span.model_request_end`→cost+token metrics; `span.outcome_evaluation_*`→pipeline/EVALUATE progress.
- [ ] Per‑loop Redis Stream `loop:{id}:events` with monotonic `seq`; upsert latest Metrics/statuses to Postgres.
- [ ] WS gateway topic multiplexing (`loop:<id>:status|pipeline|logs|metrics`, `agent:<id>:status`, `tasks:<loop>`, `global:system`); **patch‑based** updates.
- [ ] `resume(loopId, lastSeq)` replay from Redis; dedupe by event `id`; always settle terminal/status events even if seen.
- [ ] Sink worker: archive hot events to S3; roll Metrics into Postgres for HISTORY/sparklines.
- [ ] **No‑progress detector (live):** *H* cycles with no **meaningful** git diff (excluding `HANDOFF.md`/timestamp churn) and no metric delta → drop health → auto‑pause + alert.

### Frontend
- [ ] Realtime store (Zustand): single multiplexed WS, last‑`seq` tracking, seen‑set dedupe, reconnect w/ backoff, stale badges.
- [ ] `LogConsole` on xterm.js: virtualized, coalesced token deltas, autoscroll lock + "↓ N new" pill, level/agent filter, LOGS/DEBUG/OUTPUT tabs.
- [ ] `MetricGrid` sparklines (uPlot/canvas): animated append, number‑tween, delta‑color flash by `goodDirection`.
- [ ] `LoopPipeline`: stage states (active/complete/pending/error), data‑packet on the active connector, cycle counter on MEMORY→PLAN wrap, **Auto‑Layout toggle (auto‑progress vs manual single‑step)** — wire a manual step signal in the engine.
- [ ] `AgentGrid` live statuses + activity sparkline; selecting an agent scopes the LogConsole + highlights its tasks.
- [ ] `KanbanBoard` (dnd‑kit): optimistic moves reconciled against remote; live counts.
- [ ] Inspector: live ARTIFACTS rows (preview + version), searchable CONTEXT/MEMORY (pgvector), HISTORY timeline from `HANDOFF`/decisions; SUCCESS METRICS sparklines.
- [ ] Connection‑health UX: StatusBar amber "RECONNECTING" → red; live badges pause; re‑sync by diff, never flash‑reload.
- [ ] `aria-live` log region (with pause‑announcements), throttled metric announcements, keyboard kanban moves.

### Observability
- [ ] Per‑run trace view: phase timeline + `model_usage` + tool calls + grader iterations.
- [ ] Structured logging keyed by `org/loop/run/seq`; log CMA `request_id` end‑to‑end.

**Acceptance — done when:** running `marketing` shows agents flipping running/idle, logs streaming, metric cards animating, pipeline advancing with a ticking cycle counter, and kanban cards moving — all from real CMA events. Kill the WS mid‑run and reconnect: no gaps, no duplicate log lines, state settles. A deliberately stuck loop (no meaningful diff/metric for *H* cycles) auto‑pauses with a health drop.

**Demo.** The "cockpit moment": the reference UI, alive and reconnect‑safe, driven by a real loop.

**Dependencies.** Phase 2 (real sessions emitting SSE; artifacts; grader).

**Risks.** Stream gaps → resume‑by‑`seq` + dedupe (CMA reconnect‑with‑consolidation). Terminal flooding the DOM → xterm write‑buffer coalescing; metric cards sampled at a fixed UI tick. Status races (idle before queryable) → poll‑before‑settle on terminal transitions.

---

## Phase 4 — Hierarchy & Meta‑Loop  ✅ SHIPPED (Cycle 4, 2026-06-17)

> **Status:** complete. A **CEO meta‑loop** coordinates a tree of child loops, and the runaway/cost/irreversible‑action guards are enforced where autonomy first scales: **org‑wide hard cap** (stricter of loop∪org, `stricterAction`), **concurrency semaphore** (in‑mem + Redis‑gated), **cadence floors**, **`always_ask`** on irreversible tools, **child‑spawn approval** (max‑depth / per‑org cap / denial‑loop guard), and the **budget‑vs‑escalation precedence** (escalation is refused under any non‑`ok` cap or insufficient headroom, decays on a clean pass). `set_objective` writes a child's CEO‑owned `STRATEGY.md` + memory + ledger cap; the CEO review runs through the **Batch API** (50% off, pre‑warmed shared prefix). Temporal `ceoWorkflow`/spawn+review activities/cadence‑aware `IDLE_WAIT`, the HMAC webhook → `run_now`, CMA Scheduled Deployments, and the Postgres rollup views (`loop_tree`/`loop_rollup`/`org_health_daily`) are authored + gated behind Docker/creds. Cockpit: rolled‑up tree + CEO crown, ANALYTICS + ARTIFACTS (⌘I import) tabs, cadence editor, `set_objective` in HISTORY, and the approval banner. See [`HANDOFF.md`](./HANDOFF.md) for the full Cycle‑4 record. The checklist below is kept for provenance; the frozen `Event` protocol was NOT bumped (new signals reuse existing kinds).

**Goal.** Turn one loop into "loops all the way down": L1–L4 trees, the CEO meta‑loop coordinating children (Batch reviews), scheduling/continuous cadence, rolled‑up health/metrics. **This is where autonomy scales — so the concurrency semaphore, cadence floors, the org‑wide hard budget cap, and `always_ask` enforcement become real *here*, not in Phase 5.**

**Deliverables.** Child‑loop spawning (manual‑approval gate, max depth, per‑org cap); the tree wired to real parent/child relationships with upward rollups; `CeoWorkflow` (coordination via Batch); scheduling (Temporal timers + CMA Scheduled Deployments); memory at scale; enforced runaway/cost/irreversible‑action guards.

### Backend / engine
- [ ] Child‑spawn activity + **manual‑approval gate** (Commander confirms before a loop creates children); enforce max depth + per‑org child cap; **cap queued spawn requests and block re‑requesting a denied spawn** (no denial‑loop).
- [ ] Health/metric **rollup**: aggregate child health into parent (CEO sees marketing ← comedeez ← content‑creator ← workers).
- [ ] `CeoWorkflow`: async steer (read children's last persisted state; don't block); `set_objective(loopId,…)` adjusts child plan inputs + budget ledger.
- [ ] Cadence package: durable Temporal timers per tier; `IDLE_WAIT` durable sleep; CMA Scheduled Deployment bridge + **HMAC webhook receiver** → `run_now` signal.
- [ ] **Enforce the concurrency semaphore (Redis)** (cap simultaneously‑executing sessions per org) and **cadence floors** (reject ticks faster than the tier allows).
- [ ] **Enforce the org‑wide hard budget cap** (a tree of L1–L4 loops each just under their own cap can still blow the org budget) — moved up from Phase 5.
- [ ] **Enforce `always_ask` on irreversible tools now** (deploy/send/spend/delete): session pauses → route `tool_confirmation` to Commander/auto‑policy; deny carries a reason back to the agent. (Enforcement must not lag the autonomy that arrives this phase.)
- [ ] **Implement the budget‑vs‑escalation precedence in the ledger/state machine:** soft‑cap downgrade and hard‑cap pause take priority over the grader‑failure capability‑escalation bump; escalation can never push a loop over its hard cap.

### AI
- [ ] **SDK capability check (do this first):** verify the installed SDK/CLI exposes `client.beta.deployments` / `deployment_runs`; if absent, fall back to raw HTTP against `/v1/deployments` with the `managed-agents-2026-04-01` beta header.
- [ ] CEO coordinator agent whose roster is the L1 department agents; nested coordinator rosters per level (one delegation hop each, chained).
- [ ] **Batch API** path for CEO review: submit *N* child `REPORT`/Metric summaries as one batch (50% off, shared cached prefix); not for interactive EXECUTE.
- [ ] Pre‑warm (`max_tokens:0`) the CEO prefix before a scheduled review.
- [ ] Data‑driven escalation (bump model/effort on repeated grader failure, then decay) — **subordinate to the precedence rule above**.
- [ ] Worker‑loop L4 fan‑out batched on Haiku 4.5 (**no effort param, no adaptive thinking**) for mechanical/high‑volume work.

### Data
- [ ] Tree queries for the hierarchy panel; `STRATEGY.md` ownership flows from CEO objectives.
- [ ] Per‑loop memory store provisioning across the tree; CEO reads child `REPORT`/`STRATEGY`.
- [ ] **Cross‑loop rollup tables / materialized views** for ANALYTICS (aggregate health over time, per‑loop comparison, resource allocation) — the per‑loop `Metric` schema isn't enough; define this here.

### Frontend
- [ ] `LoopTree` shows real nesting + rolled‑up status; CEO node (crown, purple) with aggregate health.
- [ ] ANALYTICS tab **(first cut on the rollup views):** aggregate health over time, per‑loop comparison, resource allocation, drill‑down into any loop's inspector. (Finished in Phase 5.)
- [ ] Config: schedule/cadence editor, child‑spawn approval UI, `set_objective` surfaced in child HISTORY.
- [ ] ARTIFACTS tab: cross‑loop file/memory browser with semantic search; markdown render (shiki) + version diff; **Import Artifact (⌘I)** flow (upload → versioned `Artifact` + git commit + memory embed).

### Infra
- [ ] Scale Temporal workers + WS hub horizontally for thousands of concurrent workflows.

**Acceptance — done when:** `loop ceo` supervises `marketing → comedeez (L2) → content-creator (L3) → worker loops (L4)` and CEO health reflects the rolled‑up tree; a cadence loop ticks on its timer and a Scheduled Deployment fires the CEO's nightly review via webhook; the CEO review runs as a single Batch submission (verified 50% pricing) and writes objectives back as child signals; spawning a child requires explicit Commander approval; the org concurrency cap, cadence floor, org hard cap, and `always_ask` gate demonstrably block excess; an escalation bump is refused when it would breach the hard cap.

**Demo.** The recursive org: the CEO reprioritizes between two client units after a batched nightly review; the tree re‑colors with rolled‑up health; a risky child deploy pauses for approval.

**Dependencies.** Phases 2–3.

**Risks.** Unbounded delegation/spawning → one‑hop CMA delegation + max depth + per‑org cap + manual approval + denial‑loop guard. Cost spiral from many continuous loops → cadence floors + semaphore + org hard cap + Batch for sweeps + caching dominating re‑read cost (the second major cost checkpoint). History growth → continue‑as‑new. Cache miss on CEO reviews → pre‑warm + verify reads.

---

## Phase 5 — Production Hardening  ✅ SHIPPED (Cycle 5, 2026-06-18)

> **Status:** complete. The **four gates are enforced guardrails** and **Health % = the rolling gate‑pass rate** (engine‑owned, emitted as the canonical `health` metric; a failed required gate raises a barrier that skips IMPROVE). The **cost suite is finalized**: a caching audit that flags **mid‑life degradation**, locked per‑route efforts, the **Fable‑5 cost‑approval gate** (unapproved → downgrade to Opus), per‑org budget report + dashboard, and quantified Batch savings. **Tamper‑evidence** ships as an append‑only **hash‑chain sidecar** over events (`@departments/events/audit`, protocol still frozen at v1) + Postgres **immutability triggers + audit log + `rls_violation_audit`** (`0006_audit.sql`, RLS §G). **Alerting** (budget/no‑progress/refusal‑storm/stream‑degradation/RLS) is a pure bus + detectors in `@departments/shared/alerts`, raised by the engine and exported as Prometheus rules. **Security**: secret scan/redact, untrusted‑content fencing, `limited` deny‑by‑default networking, Vaults (egress injection), and a gateway **RBAC guard + capability decorator + auth/org‑context** over the shared **RBAC capability matrix**. **Multi‑role UI** (Owner/Commander/Operator/Viewer) with a role switcher, capability‑gated transport/approvals, a full **SETTINGS** tab (Defaults · Gate Thresholds w/ live Health preview · Members & Roles · Billing/budget dashboard · Integrations), and live gate‑threshold sliders. **Infra**: prod K8s (HPA/PDB/secrets), the alert rules, and seven launch **runbooks** (`docs/runbooks/`). DB/Temporal/CMA/Vault paths are authored + gated behind Docker/creds. The frozen `Event` protocol was **NOT** bumped. See [`HANDOFF.md`](./HANDOFF.md) for the full Cycle‑5 record. The checklist below is kept for provenance.

**Goal.** Make it safe, cheap, observable, and launchable: the full cost suite tuned on real evals, the four gates as enforced guardrails, multi‑tenancy/security finished, org‑wide observability/analytics, multi‑role UI, polish, and launch.

**Deliverables.** Cost controls finalized & swept on evals (+ per‑org dashboard); checks‑&‑balances as enforced gates; finished multi‑tenancy/security; observability/analytics; multi‑role (Operator/Viewer) UI; polish; launch.

### Cost (final)
- [ ] Sweep `effort` per route on real eval sets; lock per‑role defaults (workers: no effort; executors `medium`/`high`; judgment `high`/`xhigh`).
- [ ] Maximize Batch coverage for can‑wait fan‑out (CEO sweeps, bulk classify/lint/summarize) with shared cached prefixes.
- [ ] Audit caching across all routes; alert on `cache_read_input_tokens ≈ 0` — **including degradation mid‑life after a prompt/tool change via continue‑as‑new**; pre‑warm scheduled loops.
- [ ] Per‑org budget dashboard; tune the soft/hard caps; gate the Fable 5 path behind explicit cost approval (quarterly strategy / greenfield only).

### Backend / guardrails
- [ ] Enforce the four gates at phase boundaries (PLAN→Alignment; EXECUTE per‑unit Quality+Data; EVALUATE all four; Performance→IMPROVE). Health % = rolling gate pass rate.
- [ ] Configurable gate thresholds (no custom‑gate authoring in v1); threshold‑edit preview of Health impact in CONFIG.
- [ ] Loop‑stop cleanup: archive/delete CMA sessions, free containers, reuse environments (no orphaned resources).

### AI / security
- [ ] CMA Vaults for all third‑party creds (MCP OAuth + env‑var, egress injection); host‑side custom tools for non‑MCP secrets; **nothing secret in prompts/artifacts/event history**.
- [ ] `limited` networking deny‑by‑default for sensitive loops (allowlist hosts/MCP servers).
- [ ] Prompt‑injection posture: operator instructions on the `role:"system"` channel only; treat tool output/web content as untrusted.
- [ ] Self‑hosted CMA environment path for regulated tenants — **build the pgvector‑as‑primary‑memory fallback and host‑side‑tool creds** (`self_hosted` lacks memory stores / env‑var vault creds). *Only required if a regulated/self‑hosted tenant is in v1 scope; otherwise mark explicitly out of scope.*

### Data / multi‑tenancy
- [ ] End‑to‑end RLS audit + penetration test for cross‑tenant leakage; per‑org workspaces/vaults.
- [ ] Append‑only `Event`/`Run`/`ArtifactVersion`/memory‑version history verified tamper‑evident.

### Frontend / polish
- [ ] **Multi‑role UI:** scoped Operator view (act within an assigned loop) and read‑only Viewer view — not just the Commander profile.
- [ ] `ActivityGlobe` (react‑simple‑maps/d3‑geo + canvas arcs) rendering **only real activity nodes** (define the event→geo source); collapsible; reduced‑data drops the mesh. *(If no real geo signal exists, ship as an explicit decorative stub and label it.)*
- [ ] Complete loading/empty/error/stale states for every live organism.
- [ ] Full a11y pass (WCAG AA contrast, tree/tabs/kanban ARIA, focus traps, screen‑reader live summaries); responsive 1024/768/<768 degradation.
- [ ] ANALYTICS tab finished: org KPIs, multi‑line health, funnels, resource allocation, compare mode, drill‑down.
- [ ] SETTINGS: workspace defaults, gate thresholds, **Members & Roles**, billing/limits, integrations, realtime/connection tuning.
- [ ] **Screenshot transport control** → capture workspace to a versioned `Artifact` (define storage path + scope), or explicitly defer with a note.

### Infra
- [ ] Alerting (budget breach, no‑progress pause, refusal storms, stream degradation, RLS anomalies).
- [ ] Production K8s: autoscaled WS hub + Temporal workers; Redis/Postgres(+pgvector)/R2 prod tier; KMS.
- [ ] Launch runbooks (kill‑switch, runaway‑loop response, tenant‑isolation incident, model‑tier escalation, refusal storm).

**Acceptance — done when:** a deploy/spend action pauses the loop and waits for Commander confirmation (denying returns a reason and reroutes work); the cost report shows caching as the dominant saving, Batch halving CEO‑sweep cost, and tiering keeping bulk work on Sonnet/Haiku, with soft/hard caps firing correctly; the security review passes (no secret reachable from any sandbox; RLS blocks all cross‑tenant access; the audit trail reconstructs exactly what each department did and why); full a11y + reduced‑motion/data + responsive checks pass; Operator and Viewer roles see correctly scoped UIs.

**Demo.** Launch‑ready walkthrough: an agency CEO loop runs multiple client units overnight on cron, batches its review at 50% cost, gates a risky deploy through Commander approval, and the cost dashboard proves the order‑of‑magnitude saving — caching → tiering → batching → effort.

**Dependencies.** Phases 1–4.

**Risks.** Cost blowup at scale → the full lever stack, swept on evals, with hard caps + alerting. Sandbox escape → container‑per‑session + vault egress injection + deny‑by‑default networking + `always_ask`. Refusal stalls (Fable 5) → server‑side `fallbacks` + `stop_reason` handling (shipped P2, verified at scale here). Tenant leakage → RLS everywhere + isolation + KMS, audited.

---

## Phase 6 — Local AI & Real Data  ✅ SHIPPED (Cycle 6, 2026-06-27)

**Goal.** Make the loop actually *think* on real data, locally — pluggable model runtimes + real persistence, replacing the Phase‑1 fixtures. No cloud, no Docker, no key required.

- [x] Real runtimes behind `LoopAgentRuntime`: a shared `CompletionLoopRuntime` base + **`OllamaRuntime`** (local, `localhost:11434`, `think:false`, **$0**) + **`ClaudeRuntime`** (direct Messages API). `runtimeFromEnv()` selection; `ollama-local` **$0 sentinel** `ModelId` (role `local`, off the escalation ladder) + `providerRoles()` so a free local run is never billed at a Claude tier; **per‑role Ollama models** (`resolveCallModel(modelId, role)`).
- [x] SQLite persistence (`apps/web/lib/server/db.ts`, `node:sqlite`): `loops` + `events`; loop CRUD routes; the run route folds status/health/cycle/spend onto the loop row (survives restart).
- [x] Fixtures removed: `loops-client` registry + `workspace` identity + provider‑aware `roster`; honest empty‑states; `loop <name>` creates a real persisted department.
- [x] Cockpit: **Settings → AI Provider** pane (provider radio, live Ollama model dropdown, per‑role models, Claude key); provider/model badge; live **cost/token meters**; toasts. The durable Temporal path shares the same provider selection.

**Acceptance — done.** A real cockpit Run drove a local Ollama model through all five phases (incl. a rework) at **$0**, events persisted, per‑role models routed; merged to `main` + pushed (public GitHub). Claude path code‑complete but UNTESTED (no key). See `HANDOFF.md`.

**Dependencies.** Phases 1–5.

---

# ▶ NEXT: UX & Information Architecture (Phases 7–9)

> The platform *runs*; this 3‑phase plan makes it **legible and well‑structured to use**. Driven by hands‑on feedback. Build in order — Phase 8 (the IA restructure) is the heaviest and reframes where everything lives.

## Phase 7 — Live Run Feedback & Loop Legibility

**Goal.** A running loop should *visibly* show its progress. Today you press Run, it says "Running," and it looks like nothing is happening — fix that.

### Loop pipeline
- [ ] **Per‑phase progress on the pipeline cards** (PLAN→EXECUTE→EVALUATE→OPTIMIZE→MEMORY): the active stage fills/animates and pulses; completed stages read complete; the current phase shows a progress indication (driven by streamed events — e.g. output volume / sub‑steps — or an indeterminate animated fill where there's no granular signal).
- [ ] **Overall cycle progress:** a thin bar / "phase 3 of 5" across the pipeline, plus "cycle N of M" for multi‑cycle runs.
- [ ] **Make "Running" legible:** prominent active‑phase label, ticking elapsed timer, the latest streamed output line, and the live token/cost meter surfaced near the pipeline (the meters already exist — bring them forward).
- [ ] **Activity pulse:** a subtle, rationed liveness signal on the active stage; the LogConsole auto‑scrolls/highlights the newest lines.

**Acceptance — done when:** pressing Run shows the pipeline visibly advancing PLAN→…→MEMORY with a progress indication, the active phase pulsing, elapsed + tokens ticking; on completion every stage reads complete and the loop returns to idle. A user never has to wonder "is it doing anything?"

**Dependencies.** Phase 6 (real runs, streamed events, cost/token metrics).

## Phase 8 — Information Architecture: Org Dashboard ↔ Per‑Loop Workspace

**Goal.** Separate the whole‑app **mega‑dashboard** from a single loop's **workspace**. The 6 top tabs are org‑wide; clicking a loop opens *that loop's* page.

### Navigation model
- [ ] Define two modes — **ORG view** (the 6 top tabs aggregate across ALL loops) and **LOOP view** (a selected loop's dedicated workspace) — with a clear switch: clicking a loop in the left hierarchy enters its workspace; a breadcrumb / "back to org" returns.
- [ ] **Top 6 tabs become org‑wide aggregates:** DASHBOARD (all loops' health/status/spend), AGENTS (every agent across loops), TASKS (all tasks), ARTIFACTS (all artifacts), ANALYTICS (org rollup), SETTINGS (workspace‑level).
- [ ] **Per‑loop workspace:** clicking a loop opens its own page — its pipeline + live progress, agents, tasks, artifacts, history, and console, scoped to that loop.

### Right sidebar (Inspector) redesign
- [ ] **Merge DETAILS / CONFIG / HISTORY into ONE scrolling page** (sections stacked) instead of three tabs.
- [ ] Make the right sidebar **resizable** (drag handle) and **toggle‑collapsible**; persist width + collapsed state. (Left rail too, if cheap.)
- [ ] Decide the inspector's role in the new IA (per‑loop side context vs folded into the per‑loop workspace page).

### Creation flows
- [ ] **New Loop / New Agent / New Task** (⌘N / ⌘A / ⌘T) open **dedicated creation modals**, NOT the global‑search window (⌘K). New Loop = name + mission + level/parent → a persisted department. New Agent / New Task scoped to a loop with the right fields (or a clear scope + honest state if not yet backed).

**Acceptance — done when:** the 6 top tabs show whole‑org aggregates; clicking any loop in the hierarchy opens its own workspace page with that loop's progress/details; the right inspector is one scrolling, resizable, collapsible panel; ⌘N/⌘A/⌘T each open a distinct creation modal (never the search window).

**Dependencies.** Phase 6 (loop registry + per‑loop data); Phase 7 (the per‑loop progress view it embeds).

## Phase 9 — Members, Roles & Integrations (real management)

**Goal.** Settings reflects reality: manage real members; integrations tell the truth.

### Members & Roles
- [ ] **Remove the 4 default fake members** (Alex Rivera / Commander / Sam Operator / Jordan Viewer). Start from just the real local commander.
- [ ] **Add member** — a modal (name + email + role), persisted (local store / SQLite).
- [ ] **Delete member** — with a guard (can't delete the last owner / yourself).
- [ ] Role assignment respects the RBAC matrix (`canAssignRole` — no privilege escalation).

### Integrations
- [ ] **Fix the "GATED (DOCKER/CREDS)" labels** — verify accuracy and relabel honestly for a local‑first app: what's actually connectable now vs genuinely gated. (e.g. **Ollama** is live/connected locally; CMA / Temporal / Redis / Postgres are truly gated until Docker/creds.)
- [ ] Surface real connections with live status (Ollama daemon reachable ✓) and a way to **connect/configure** the real ones; show gated ones as "not configured · requires Docker/creds," not as if they're broken.

**Acceptance — done when:** Members starts clean (no fake people) and supports add + delete with correct role gating; Integrations honestly reflects what's connected (Ollama live) vs gated, with a path to configure the real ones.

**Dependencies.** Phase 6 (real workspace identity + SQLite for persistence).

> **Still in the backlog (after the UX phases):** test the Claude provider (needs a key) · make GitHub CI green · the prod data plane (Docker → Postgres/pgvector + real `db:migrate` + RLS §A–G · Temporal workflows · gateway↔Postgres) · a real CMA client · remaining web gaps (real tasks projection, ANALYTICS on persisted views, screenshot transport, full a11y). Full detail in `HANDOFF.md`.

---

## Cross‑cutting / Definition of Done

**Testing.** Unit (state‑machine transitions, gate routing, event normalizer, ledger math, `(model,knob)` policy); integration (`LoopWorkflow` against a CMA sandbox, resume‑from‑`HANDOFF`, reconnect‑by‑`seq` + dedupe); contract tests on the `Event` protocol; RLS policy tests as a CI gate from migration #1; eval sets for grader rubrics and effort/model sweeps. **A loop run is not "green" unless the grader's Outcome `result` and a real artifact diff agree.**

**CI/CD.** Typecheck + lint + unit + RLS + `(model,knob)` tests on every PR; build all packages; one‑time CMA agent/environment provisioning from version‑controlled `ant` YAML (never per‑tick); migrations gated; staged rollout with a kill‑switch.

**Docs.** This plan, the architecture, the UI spec, ADRs (CMA‑vs‑self‑hosted, Temporal, model‑tier table), runbooks, and the per‑loop artifacts (`README/TASKS/HANDOFF/REPORT/STRATEGY`) which are themselves the system's living documentation.

**Cost budget guardrails (the through‑line).** Caching discipline from P1; tiering + adaptive thinking + per‑role effort from P2; Batch + cadence floors + concurrency semaphore + org hard cap from P4; full per‑org soft/hard caps, `count_tokens` pre‑checks, Fable‑5‑behind‑approval, and eval‑tuned sweeps in P5. Order of saving is explicit and tracked: **caching → tiering → batching → effort.**

**Security.** RLS on every tenant table (tested continuously); container‑per‑session isolation; CMA Vaults (egress injection) for agent creds, KMS for platform secrets, **never** secrets in prompts/artifacts/event history; `limited` deny‑by‑default networking for sensitive loops; `always_ask` human‑in‑the‑loop on irreversible actions (enforced P4); no self‑grading on Alignment/Risk; append‑only tamper‑evident audit trail.

**Sequencing rationale.** Each phase is shippable and de‑risks the next. **P1** front‑loads the riskiest *contracts* — data model, RLS, the frozen `Event` protocol, and the cost‑ledger + cache‑shaped runtime seams. **P2** proves the single hardest *capability* (a real, gated, resumable cycle on CMA with files‑as‑memory and an independent grader). **P3** makes that loop *observable and trustworthy* and adds the no‑progress guard. **P4** scales the proven primitive into the recursive org **and turns on the runaway/cost/irreversible‑action guards exactly where autonomy first scales** (not deferred to P5). **P5** hardens what now exists into something safe and economical to operate. Guardrails are seeded early and enforced where each one first becomes load‑bearing — never bolted on at the end.
