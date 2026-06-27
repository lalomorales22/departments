# ◈ DEPARTMENTS

> **One word. Infinite orchestration.**
> `loop <anything>` spins up an autonomous **department** that thinks, acts, and improves — for any business, any website, any software.

Departments is an orchestration platform that turns any business function, product, or project into a self-improving **Loop** — an autonomous department of AI agents that owns a mission and runs a perpetual **PLAN → EXECUTE → EVALUATE → IMPROVE → MEMORY** cycle. A top-level `loop ceo` supervises every department, so the whole organization becomes a recursive tree of loops — *loops all the way down*.

> **Status:** **It runs for real — locally, with no cloud and no Docker.** A loop now genuinely *thinks*: a pluggable **agent runtime** drives each PLAN → EXECUTE → EVALUATE → IMPROVE → MEMORY cycle on a real model — a **local Ollama** model (default, $0, runs on your own hardware), the **Claude Messages API**, or a deterministic offline runtime. The cockpit runs on real, **SQLite‑persisted** data (loops, runs, event history that survives restart) — the demo fixtures are gone; `loop <name>` creates a real department, you pick the model in **Settings → AI Provider**, and live **cost/token meters** tick as it works.
>
> Underneath, all five phases of the [5‑phase plan](./TASKS.md) are complete (Foundations · The Loop Engine · The Live Dashboard · Hierarchy & Meta‑Loop · Production Hardening): the four gates are **enforced** (Health % = rolling gate‑pass rate), a CEO meta‑loop coordinates a guarded tree of child loops, the cost suite is finalized, and history is append‑only/tamper‑evident with alerting + multi‑role RBAC + per‑org security. The prod data plane (Postgres/pgvector · Temporal · Redis · CMA Vaults) is authored and gated behind Docker/creds. The repo is itself a `loop software-builder` — its current memory lives in [`HANDOFF.md`](./HANDOFF.md) (read it first), with `README.md` + `TASKS.md` as the founding spec.

---

## Table of contents

1. [What is a Loop?](#what-is-a-loop)
2. [The Loop lifecycle (canonical)](#the-loop-lifecycle-canonical)
3. [Principles](#principles)
4. [The 4‑level hierarchy](#the-4-level-hierarchy)
5. [Inside a loop](#inside-a-loop)
6. [Files as memory (the load‑bearing invariant)](#files-as-memory-the-load-bearing-invariant)
7. [Checks & balances + the human‑on‑top guardrails](#checks--balances--the-human-on-top-guardrails)
8. [The CEO meta‑loop](#the-ceo-meta-loop)
9. [Architecture](#architecture)
10. [The AI layer & model tiering](#the-ai-layer--model-tiering)
11. [Cost control](#cost-control)
12. [The UI — mission control](#the-ui--mission-control)
13. [Data model](#data-model)
14. [Repository structure](#repository-structure)
15. [Getting started](#getting-started)
16. [Roadmap](#roadmap)
17. [Glossary](#glossary)

---

## What is a Loop?

A **Loop** is the atomic unit of the system: an autonomous **department** that owns a single ongoing **mission** and runs the lifecycle cycle indefinitely. A loop is **not a task** — it is a persistent organizational function (`marketing`, `software-builder`, `seo`) with its own identity, agents, artifacts, memory, and health. Loops nest: any loop can spawn and supervise child loops.

```
loop marketing      → a department that owns "increase brand awareness & drive qualified traffic"
loop software-builder → a department that ships clean, tested, production-ready code
loop ceo            → the department that runs the whole organization
loop <anything>     → a department that thinks, acts, and improves
```

---

## The Loop lifecycle (canonical)

Every loop is a cyclic state machine over five phases. One full traversal is a **cycle**; the loop runs cycles indefinitely until paused or stopped.

```
        ┌───────────────────────────────────────────────────────────┐
        │                                                           ▼
  PLAN ──▶ EXECUTE ──▶ EVALUATE ──▶ IMPROVE ──▶ MEMORY ──▶ (next cycle)
        ▲                  │
        │            gate fail → rework (back to EXECUTE)
        └──────────────────┘
```

### ⚠️ Canonical phase ↔ UI stage ↔ color mapping (the single source of truth)

The engine's 4th phase is named **IMPROVE**; the UI pipeline labels that same stage **OPTIMIZE**. They are the same thing. `Run.phase` uses `improve`; the dashboard renders `OPTIMIZE`. This is the one piece of vocabulary that **must not drift** — bind everything to this table:

| Engine phase | UI stage label | Accent color | Consumes | Produces |
|---|---|---|---|---|
| `plan` | **PLAN** | cyan `#22D3EE` | mission, latest `HANDOFF.md`, memory, prior `REPORT.md` | refreshed `TASKS.md`, goals/strategy delta, agent assignments |
| `execute` | **EXECUTE** | green `#34D399` | `TASKS.md`, agent roster, memory/context | code, content, drafts, task-state changes, sub-artifacts |
| `evaluate` | **EVALUATE** | purple `#A78BFA` | execution outputs, success metrics | per-gate pass/fail, metric deltas, evaluation notes |
| `improve` | **OPTIMIZE** | amber `#FBBF24` | evaluation results, learnings | optimizations, refined strategy, reprioritized backlog, `REPORT.md` |
| `memory` | **MEMORY** | blue `#60A5FA` | all cycle artifacts, decisions, insights | updated `HANDOFF.md`, distilled memory entries |

**MEMORY is the only legal handoff between cycles.** It writes `HANDOFF.md` and appends distilled insights to searchable memory; the next PLAN's first act is to read them. That is what makes a loop *improving* rather than merely *repeating*.

---

## Principles

- **Department, not task.** A loop owns an ongoing mission end‑to‑end; it is never "completed" and discarded.
- **Hierarchical.** Loops contain agents; agents spawn subagents; loops contain child loops. Scales infinitely.
- **Artifact‑driven.** Loops use human‑readable files as durable memory — `README.md`, `TASKS.md`, `HANDOFF.md`, `REPORT.md`, `STRATEGY.md`, plus source code.
- **Data & improvement.** Every loop runs on data, measures results, and continuously improves.
- **Human on top.** Cost caps and human approval gates always override agent autonomy and capability escalation (see [guardrails](#checks--balances--the-human-on-top-guardrails)).

---

## The 4‑level hierarchy

Levels nest by **ownership and supervision**: a loop at level *N* spawns, supervises, and allocates to loops at level *N+1*, and rolls their health/metrics upward. Every level is itself a *full* loop (same lifecycle, agents, gates, artifacts) — the difference is mission altitude, not mechanism.

| Level | What lives here | Examples |
|---|---|---|
| **L1 — Company Departments** | High‑level functions that run the business | `ceo`, `strategy`, `operations`, `finance`, `marketing`, `sales`, `product`, `engineering`, `people`, `legal`, `research`, `it` |
| **L2 — Business / Product Units** | Specific brands, products, units, initiatives | `product-a`, `brand-x`, `service-y`, `comedeez`, `southbayitsolutions`, `batchy` |
| **L3 — Execution Departments** | Core execution areas that drive outcomes | `software-builder`, `content-creator`, `seo`, `analytics`, `customer-support`, `data-research`, `growth`, `design`, `campaign-manager` |
| **L4 — Worker Loops** | Specialized workers that execute one task type | `plan`, `build`, `test`, `review`, `document`, `design`, `deploy`, `monitor`, `optimize` |

**A name can be a loop *or* an agent depending on scope.** `campaign-manager` may be an L3 *execution loop* (its own mission, cadence, artifacts) **or** a Campaign Manager *agent* inside the `marketing` loop. The rule: **a persistent mission with its own cadence and artifacts is a child loop; a transient role inside one cycle is an agent.**

Example nesting:

```
loop ceo (L1)
└─ loop marketing (L1)
   └─ loop comedeez (L2 brand)
      └─ loop content-creator (L3)
         ├─ loop write   (L4)
         ├─ loop design  (L4)
         └─ loop deploy  (L4)
```

---

## Inside a loop

### The agent roster

Each loop runs a canonical roster. Each agent deploys **subagents** for fan‑out (read many files, run many tests).

| Agent | Role | Responsibility |
|---|---|---|
| **Planner** | `planner` | Breaks down work, creates plans and priorities, refreshes `TASKS.md`. |
| **Developer / Executor** | `executor` | Implements features, writes code/content, fixes issues. |
| **QA / Tester** | `qa` | Tests, reviews, ensures quality. |
| **Docs / Writer** | `docs` | Updates docs, `README.md`, `TASKS.md`, `HANDOFF.md`. |
| **Reviewer** | `reviewer` | Evaluates results, checks alignment with goals (the independent grader). |
| **Coordinator** | `coordinator` | Meta/CEO‑level role: delegates to and supervises child loops/departments. |

### The bootstrap sequence (resumable, idempotent)

When `loop <name>` is invoked, the loop tries to **resume** first, then falls back to setup:

```
on `loop <name>`:
  1. HANDOFF.md exists?  → load it → RESUME at the recorded phase/task
  2. else README.md exists? → parse project, goals, specs, architecture → step 3
  3. TASKS.md exists?   → load phased plan + task states → enter PLAN
                          else generate TASKS.md from README → enter PLAN
  4. cold start: ask the user "what kind of loop is this?" (mission, level) → initialize artifacts
```

---

## Files as memory (the load‑bearing invariant)

All authoritative state lives in **artifacts**, never in RAM. This is what makes "runs indefinitely" safe and every cycle resumable by any agent (human or AI) at any time.

| Artifact | Purpose | Written at | Read at |
|---|---|---|---|
| `README.md` | Technical specs, overview, architecture | bootstrap / on change | bootstrap |
| `TASKS.md` | The 5–10 phase plan with breakdown (mirrors the Kanban board) | PLAN | PLAN |
| `HANDOFF.md` | Progress, decisions, next steps — **the only legal cross‑cycle handoff** | MEMORY (every cycle) | bootstrap (first) |
| `REPORT.md` | Insights, results, learnings — feeds CEO review + metrics | IMPROVE | PLAN, CEO review |
| `STRATEGY.md` | Direction, derived from PLAN / CEO objectives | PLAN | PLAN |
| `src/…` | Clean, tested, production‑ready source (builder loops) | EXECUTE | — |

Three coordinated memory tiers back every loop: **artifacts** (canonical, versioned, in Git), a **memory store** (durable agent notes across sessions), and a **vector index** (semantic recall via pgvector). PLAN consults all three.

> **Guardrail note:** because `HANDOFF.md` is rewritten *every* cycle, a git diff always exists — so the no‑progress detector counts only a **meaningful** delta (real source/content/decision changes), explicitly excluding handoff/timestamp churn.

---

## Checks & balances + the human‑on‑top guardrails

### The four gates

Work must pass four gate categories before MEMORY. They are implemented as **rubric categories** scored by an **independent grader** (no self‑grading):

| Gate | Checks |
|---|---|
| **Quality** | Standards met, outputs are correct and complete |
| **Data validation** | Accuracy of facts, numbers, and claims |
| **Alignment / Risk & Security** | On‑mission, safe, and within policy |
| **Performance** | Measured against success metrics; optimize |

### Human‑on‑top guardrails (precedence is explicit)

- **Commander holds the kill switch.** Pause/stop any loop at any time.
- **Irreversible actions require approval.** Deploy, send, spend, and delete run behind `always_ask` — the loop pauses for human (or policy) confirmation.
- **No self‑grading.** The Alignment/Risk gate is scored by an independent reviewer, never the executor.
- **Child‑loop spawning needs manual approval** in v1.
- **Precedence rule (non‑negotiable):** **cost caps and human gates OVERRIDE autonomy and capability escalation.** A grader‑failure escalation bump may *never* push a loop past its hard budget cap; a soft‑cap downgrade always wins over an escalation upgrade.

Backing these: a per‑loop and per‑org **budget ledger** (soft cap → auto‑downgrade effort/model; hard cap → pause + alert), **cadence floors** (a loop can't tick faster than its tier), and a per‑org **concurrency semaphore**.

---

## The CEO meta‑loop

`loop ceo` is a full loop whose **mission is the organization itself**. Its EXECUTE phase is **coordination, not production**:

- Review every child loop, prioritize initiatives, allocate resources/budget, generate strategy, monitor performance, drive growth.
- On each tick it gathers every child's latest metrics + `REPORT.md`/`HANDOFF.md` (cheaply, via the **Batch API**), runs a high‑effort strategy turn, and writes objectives back to children as signals.
- It **steers asynchronously** — it reads children's last persisted state and never blocks on them, matching the "ongoing mission" model.

---

## Architecture

The load‑bearing design choice: keep **all** model access behind ONE `agent-runtime` seam (the `LoopAgentRuntime` contract) so the orchestration engine never calls a model directly. That seam is now **real and pluggable** — the same four‑method contract is satisfied by four providers, and the choice is a deployment detail, not an architectural fork:

| Provider | What it is | When |
|---|---|---|
| **Ollama** (`OllamaRuntime`) | A model on the user's own machine via the local Ollama daemon — streamed, **$0**, no key, no Docker | **Default for local.** The fastest path to a real, running loop |
| **Claude** (`ClaudeRuntime`) | The Anthropic **Messages API**, direct (no SDK) — per‑role model tiering or one pinned model | Cloud quality; needs an `ANTHROPIC_API_KEY` |
| **Fake** (`FakeCmaRuntime`) | A deterministic, network‑free runtime that writes real artifacts | Offline demos + the engine's own tests |
| **CMA** (`CmaRuntime`) | **Anthropic Managed Agents** — a secure, stateful, file‑capable cloud sandbox with streaming/caching/compaction | The prod/multi‑tenant target (gated behind creds) |

The orchestration, real‑time, product, and cost‑control layers are owned around that seam. The original bet was to build it on **CMA** (below); the local **Ollama**/**Claude** runtimes realize the same contract today so the platform is useful and demoable with zero cloud.

```
┌──────────────────────────────────────────────────────────────────────┐
│ FRONTEND — Next.js mission-control SPA (3-column dark dashboard)        │
└───────────────▲──────────────────────────────────────▲────────────────┘
        HTTPS / GraphQL+REST                     WebSocket (live)
┌───────────────┴──────────────────────────────────────┴────────────────┐
│ API / GATEWAY (NestJS) — auth, RBAC, tenant scoping, `loop <x>` intake, │
│ cost/rate limits, GraphQL resolvers, WS/SSE fan-out hub                 │
└──┬────────────────────┬─────────────────────┬──────────────────┬───────┘
   ▼                    ▼                     ▼                  ▼
┌──────────────┐ ┌─────────────────┐ ┌──────────────────┐ ┌──────────────┐
│ ORCHESTRATION│ │  PERSISTENCE    │ │  REAL-TIME LAYER │ │ SECRETS/VAULT│
│ ENGINE       │ │ Postgres(state) │ │ Redis Streams →  │ │ CMA Vaults + │
│ (Temporal:   │ │ + pgvector(mem) │ │ WS/SSE gateway   │ │ cloud KMS    │
│ 1 durable    │ │ + S3/R2(artifacts│ │ (dedupe, resume) │ └──────────────┘
│ workflow per │ │   & log archive)│ └────────▲─────────┘
│ Loop ticks   │ └────────▲────────┘          │ session SSE
│ the cycle)   │          │                   │
└──────┬───────┘          │                   │
       │ start session / send events / stream │
       ▼                                       │
┌──────────────────────────────────────────────────────────────────────┐
│ AGENT RUNTIME — Anthropic Managed Agents (CMA)                          │
│ Agent = versioned department template · Session = one loop run          │
│ Container = artifact substrate · Outcomes = EVALUATE/IMPROVE            │
│ Multiagent coordinator = CEO→dept, planner→executor · Memory stores     │
└───────────────┬───────────────────────────────────────┬────────────────┘
                ▼ model inference                        ▼ MCP / custom tools
   Claude Messages + Batch API                  GitHub · Slack · Drive · …
```

> The diagram shows the **prod (CMA) target**. Today the **AGENT RUNTIME** box is whichever provider you select — locally an `OllamaRuntime` (talking to `localhost:11434`) or a `ClaudeRuntime` (the Messages API), and **PERSISTENCE** is a local **SQLite** file instead of Postgres. The boundaries are identical; only the adapters differ.

### Tech stack (defaults)

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js (React) + TypeScript**, Tailwind, Zustand, TanStack Query | Data‑dense SPA; rich realtime/charting ecosystem |
| Terminal / charts | **xterm.js**, **uPlot/visx** | High‑throughput log pane; cheap live sparklines |
| Backend | **Node.js + NestJS** | Shared TS types with the front end; first‑class `@anthropic-ai/sdk`; strong SSE/WS |
| Orchestration | **Temporal** (durable workflows) | "Runs indefinitely" = durable timers/signals/replay that survive restarts |
| Primary DB (prod) | **PostgreSQL** (+ **pgvector**) | Relational loop hierarchy + RLS multi‑tenancy + co‑located memory search |
| Local store | **SQLite** (`node:sqlite`, single file in `.volumes/`) | The local cockpit's REAL store for loops + event history — survives restart, no Docker. Postgres is the multi‑tenant/prod path |
| Object storage | **S3 / Cloudflare R2** | Versioned artifact blobs + run‑log archives |
| Eventing | **Redis Streams** | Tick dispatch + per‑loop append‑only event stream with replay‑from‑offset |
| Realtime | **WebSocket** (browser) ← **SSE** | Terminate the engine's SSE server‑side, multiplex one WS to the UI |
| Agent runtime | **Pluggable behind one seam** — Ollama (local, default, $0) · Claude Messages API · Fake (offline) · Managed Agents (cloud, gated) | The engine holds only a `LoopAgentRuntime`; the provider is a deployment choice, not a fork |
| Artifacts VCS | **Git** (per‑loop repo, CMA repo mounts) | Files‑as‑memory wants real diffs, blame, history |
| Auth | Clerk/Auth0/WorkOS + org RBAC + **Postgres RLS** | Outsource identity; enforce tenant isolation at the row |
| Secrets | **CMA Vaults** (agent creds) + cloud **KMS** (platform) | Creds injected at egress, never visible in the sandbox |

### Concept → CMA mapping

| Concept | CMA primitive |
|---|---|
| Loop = department template | **Agent** object (versioned `{model, system, tools, skills, mcp_servers}`), created once, referenced by ID |
| One run of a loop | **Session** (provisions a container) |
| Artifact‑driven files | Session **container** + mounted **Git repo** |
| EVALUATE + IMPROVE / checks & balances | **Outcomes** (`user.define_outcome` + rubric → grader iterates) |
| CEO→dept, planner→executor | **Multiagent coordinator** (one delegation hop per layer, chained) |
| "Runs on a cadence" | **Scheduled Deployments** (cron) + Temporal timers |
| MEMORY phase | **Memory stores** (cross‑session, FUSE‑mounted) |
| Credentials | **Vaults** (egress injection) |
| Live terminal/logs + agent status | Session **SSE** event stream |

> The engine never calls a model directly — it holds only a `LoopAgentRuntime` (`startSession / executePhase / evaluate / endSession`). A single `agent-runtime` package owns all model access, so the **provider choice — Ollama · Claude · Fake · CMA** — is a deployment detail, not an architectural one. (The CMA‑native `AgentRuntime` primitive — `sessions`/`outcomes` — sits beneath this for the managed‑cloud path.)

---

## The AI layer & model tiering

The provider is chosen in **Settings → AI Provider** (or via env on the CLI/worker). Two worlds:

- **Local (Ollama).** Every role runs the **one local model you pick**, billed as the knobless **`ollama-local`** sentinel at **$0**. No effort/thinking params are sent; thinking‑capable models are called with `think:false` so they return the answer (artifacts), not the chain‑of‑thought. This is the default and needs no key, no cloud, no Docker. The model name (e.g. `gemma4:12b-it-qat`) rides on the runtime; the closed `ModelId` union stays Claude‑shaped.
- **Claude.** The per‑role tiering below applies (or pin one model). **Read the caveats — several knobs error on the wrong model.**

| Role / level | Model | Model ID | Context | Thinking | Effort | $/1M (in · out) |
|---|---|---|---|---|---|---|
| Local (any role, Ollama) | your installed model | `ollama-local` *(sentinel)* | model‑dependent | — (knobless) | — (omit) | **$0** |
| CEO meta‑loop · Planner · Reviewer/grader | Claude Opus 4.8 | `claude-opus-4-8` | 1M | adaptive | `high` (default); `xhigh` for hard agentic | $5 · $25 |
| Hardest strategy / greenfield (gated) | Claude Fable 5 | `claude-fable-5` | 1M | always‑on (omit param) | `xhigh` / `max` | $10 · $50 |
| Executor agents (dev, content, SEO, analyst) | Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | adaptive | `medium`→`high` (ceiling `max`) | $3 · $15 |
| L4 worker loops (lint, format, classify, simple test) | Claude Haiku 4.5 | `claude-haiku-4-5` | **200K** | — (not adaptive) | — (omit entirely) | $1 · $5 |

### ⚠️ Model‑knob caveats (guaranteed 400s if you get these wrong)

- **`xhigh` is Opus‑4.7+/Fable‑only.** Never set it on Sonnet 4.6 (it caps at `max`, there is no `xhigh` rung) or on Haiku 4.5.
- **The `effort` parameter errors on Haiku 4.5** (and Sonnet 4.5). **Worker loops omit `effort` entirely.**
- **Adaptive thinking is Opus 4.6+ / Sonnet 4.6 / Fable 5 only.** Do **not** send `thinking:{type:"adaptive"}` to Haiku 4.5.
- **Opus 4.8 & Fable 5:** no `budget_tokens`, no `temperature`/`top_p`/`top_k` (all return 400). Control depth with `output_config.effort`.
- **Fable 5:** never send `thinking:{type:"disabled"}` (400) — *omit* the param. It requires the server‑side `fallbacks` parameter (`betas:["server-side-fallback-2026-06-01"]`, fallback `claude-opus-4-8`) so a `stop_reason:"refusal"` doesn't kill a tick, and **30‑day data retention**.
- **CI must assert** the model‑tier policy table never pairs an unsupported `(model, knob)`: `Haiku+effort`, `Haiku+adaptive`, `Sonnet-4.6+xhigh`, `Fable+thinking-disabled`.

**Escalation policy** is data‑driven: if a grader fails *N* times or health drops, bump the role's model/effort one tier next run, then decay — but the [precedence rule](#checks--balances--the-human-on-top-guardrails) means escalation can never breach the hard budget cap.

---

## Cost control

**The ultimate local lever — run on Ollama for $0.** For development and self‑hosting, the local provider eliminates model cost entirely (it runs on your own hardware), so the budget ledger reads $0 and the live **Cost/Tokens meters** in the header simply show tokens produced. The four levers below govern the **cloud** (Claude/CMA) path.

A loop "re‑runs constantly," so cost discipline is **structural, not optional**. Four levers, applied in order of impact:

1. **Prompt caching (≈0.1× on cache reads) — the #1 lever.** The repeated prefix across every tick (system prompt + tool/skill defs + shared department/project context) is large and stable. Freeze it (no `datetime.now()`/UUIDs; deterministic tool order; inject per‑tick context as a mid‑conversation `role:"system"` message). Verify with `usage.cache_read_input_tokens`; alert if it's ~0 across ticks of the same loop. Pre‑warm (`max_tokens:0`) before scheduled CEO reviews.
2. **Model tiering.** Mechanical work on Haiku, volume execution on Sonnet, judgment on Opus, only the hardest strategy on Fable 5. A naive "everything on Opus" design costs ~5× the tiered design.
3. **Batch API (50% off).** For non‑latency‑sensitive fan‑out: the CEO's periodic review of all loops, and bulk worker classify/lint/summarize. Never for interactive EXECUTE turns the user is watching.
4. **Effort tuning per role.** `low` for workers (omit on Haiku), `medium`/`high` for executors, `high`/`xhigh` only where correctness dominates.

Backed by the **budget ledger** (soft cap → downgrade, hard cap → pause), **cadence floors**, **concurrency semaphore**, and `count_tokens` pre‑checks before large/batch submissions. Note Haiku's **200K** context (vs 1M elsewhere) as a tiering constraint.

---

## The UI — mission control

A dark **command‑center** dashboard ("ORCHESTRATE EVERYTHING") — an ops floor for autonomous systems, not a chat app. Design ethos: **instrumentation over decoration**, **calm‑until‑it‑matters** (color = liveness, rationed), engineered hairline‑bordered surfaces, monospace for everything machine‑emitted. Explicitly **avoids** generic AI‑SaaS slop (purple‑pink hero gradients, glassmorphism everywhere, emoji icons, pastel "friendly AI" palettes).

**Three‑column layout:**

- **Left** — the `> loop <name>` command bar, the hierarchy tree (CEO / Business / Execution / Worker loops with live status dots), quick actions (New Loop ⌘N, New Agent ⌘A, New Task ⌘T, Import Artifact ⌘I, Global Search ⌘K), and the Commander profile.
- **Center** — active‑loop header + elapsed timer, the **Loop Pipeline** (PLAN→EXECUTE→EVALUATE→OPTIMIZE→MEMORY), Loop Health % + objective, the **Agents** grid, the **Task Board** kanban (TODO/IN PROGRESS/REVIEW/DONE), **real‑time metric** sparkline cards, the **Terminal/Logs** console (LOGS/DEBUG/OUTPUT), and a world‑map activity view.
- **Right** — the **Loop Inspector** (DETAILS / CONFIG / HISTORY): mission, success metrics, artifacts list, searchable context/memory, system status.

**Tabs:** `DASHBOARD · AGENTS · TASKS · ARTIFACTS · ANALYTICS · SETTINGS`. **Keyboard‑first:** ⌘K search, ⌘P command palette / run loop, plus the bottom status‑bar chord set (Debug ⌘D, Find ⌘F, Explorer ⌘E, Map ⌘M, Help ?).

**Real data + live instrumentation (no demo fixtures):**

- **`loop <name>` creates a real department** — persisted to the local SQLite store and added to the hierarchy tree. An empty workspace shows an honest "create your first department" state, not seeded mock data.
- **Settings → AI Provider** — choose **Ollama** (with a live dropdown of the models installed on your machine, populated from the daemon's `/api/tags`) or **Claude** (with an API‑key field). A **provider/model badge** in the loop header always says what's actually executing.
- **Live Cost/Tokens meters** in the header tick as the engine streams `cost_usd`/`tokens` metrics; the same feed drives the dashboard sparkline cards. **Health %** is the real rolling gate‑pass rate, not a constant.
- **Toasts** give real success/error feedback (department created, run failed, schedule saved) instead of silent failures. The **SSE connection dot** in the status bar shows live/reconnecting/stale.
- The Inspector reads **real artifacts + distilled memory** from the loop's git working tree once it has run.

**Color = state:** cyan (PLAN/selection/focus), green (running/healthy/EXECUTE), amber (review/OPTIMIZE/pending), purple (EVALUATE/memory/AI cognition), red (stop/error/P1), blue (MEMORY/info). Glow only on live/selected/focused elements. Full spec: deltas respect a per‑metric `goodDirection` (Bounce Rate down = green), status colors live in one `statusTheme` map, two type families only (Geist + Geist Mono).

---

## Data model

> **Local vs prod.** The local cockpit persists a lightweight, realized subset to **SQLite** (`.volumes/departments.db`): a **`loops`** table (the registry) and an **`events`** table (the full per‑loop stream), with each loop's last‑run **status / health / cycle / spend** folded back onto its row from the live feed so it survives a restart. Git artifacts + JSONL memory continue to live on disk. The full relational schema below — with RLS, pgvector, and the audit spine — is the **Postgres** multi‑tenant/prod target.

Core entities (Postgres; every tenant row carries `org_id`, enforced by RLS):

```
Org 1─* User(role∈ owner|commander|operator|viewer)
Org 1─* Loop(level 1..4, parent_loop_id?, mission, status, health, cadence,
             cma_agent_id, memory_store_id, repo_url, budget_cap)   ← self-referential tree
Loop 1─* Agent(role∈ planner|executor|qa|docs|reviewer|coordinator, model_id, effort, status)
Agent 1─* Subagent(cma_thread_id, status)                            ← transient fan-out
Loop 1─* Task(area, priority P1..P3, state∈ todo|in_progress|review|done)   ← Kanban
Loop 1─* Run(phase∈ bootstrap|plan|execute|evaluate|improve|memory, tick_no,
             cma_session_id, usage, cost_usd)                        ← audit spine
Run  1─* Event(seq, kind∈ log|debug|output|agent_msg|tool_use|status|metric|error)  ← terminal feed
Loop 1─* Metric(name, value, delta, ts)                             ← live cards
Loop 1─* Memory(path, summary, embedding vector, content_ref)       ← context panel (pgvector)
Loop 1─* Artifact(kind∈ readme|tasks|handoff|report|strategy|source|dashboard) 1─* ArtifactVersion
Run  0..1─1 Outcome(result) *─1 Rubric(category∈ quality|data_validation|alignment_risk|performance)
Org  1─* Vault(cma_vault_id)
```

---

## Repository structure

```
departments/
├── apps/
│   ├── web/            # Next.js cockpit + SQLite store (lib/server/db.ts), loop registry, AI-provider settings, run/stream/inspect routes
│   ├── gateway/        # NestJS edge: auth, RBAC, GraphQL+REST, WS hub, `loop` intake
│   └── orchestrator/   # Temporal worker host (selects the same providers as the CLI)
├── packages/
│   ├── orchestration/  # the engine: cycle state-machine, activities, scheduling, local-driver + CLI
│   ├── agent-runtime/  # the LoopAgentRuntime seam: ollama · claude · completion-runtime base · provider selector · cma + models (tier policy) + security/vault
│   ├── artifacts/      # git provisioning, snapshot/versioning, S3 sync, embeddings
│   ├── memory/         # memory-store sync + pgvector index + retrieval
│   ├── events/         # the frozen unified Event schema + resume/dedupe contract
│   ├── realtime/       # the reconnect-safe spine: EventStream (in-mem + Redis) + resume/dedupe + topics + reconnect
│   ├── cost/           # caching helpers, batch submission, count_tokens, budget ledger
│   ├── rubrics/        # checks-&-balances rubric library
│   ├── db/             # schema, migrations, RLS policies
│   └── shared/         # cross-package types, config, telemetry
├── infra/              # K8s, Temporal, Redis, Postgres(+pgvector), R2/S3, KMS
├── scripts/            # one-time CMA agent/environment provisioning (ant YAML)
└── docs/               # architecture, runbooks, ADRs
```

**Boundary:** `orchestration` owns the cycle and never calls a model; `agent-runtime` is the only package that talks to a provider (Ollama daemon / Claude Messages API / CMA).

---

## Getting started

The fastest real loop is **fully local** — no cloud, no Docker, no API key:

```bash
pnpm install
# Optional but recommended — install Ollama (https://ollama.com) and pull a model:
#   ollama pull gemma4:12b-it-qat      # a tool-capable instruction model loops well
pnpm --filter @departments/web dev     # the cockpit at http://localhost:3000
```

Then, in the cockpit:

1. **Settings → AI Provider** — choose **Ollama** and pick a model from the live dropdown (your installed models are listed automatically). Or choose **Claude** and paste an `sk-ant-…` key.
2. **Create and run a department** from the command bar:
   ```
   > loop marketing      # creates + focuses a real, persisted department
   > run marketing       # …and fires one real cycle (or hit the ▶ button)
   ```
3. Watch a real model stream **PLAN → EXECUTE → EVALUATE → IMPROVE → MEMORY** live into the console. Real artifacts (`HANDOFF.md`, `REPORT.md`, source) + distilled memory land in `.volumes/`; the loop and its full event history persist in SQLite and survive a restart.

The same flow runs headless from the CLI:

```bash
DEPARTMENTS_PROVIDER=ollama OLLAMA_MODEL=gemma4:12b-it-qat \
  pnpm --filter @departments/orchestration exec tsx src/cli.ts marketing --stream --cycles 1
```

**Full prod stack (multi‑tenant, optional):**

```bash
docker compose up -d        # Postgres(+pgvector), Redis, Temporal, MinIO
pnpm db:migrate             # schema + RLS policies
pnpm dev                    # web (Next.js) + gateway (NestJS) + orchestrator (Temporal)
# Set ANTHROPIC_API_KEY for Claude; USE_CMA_RUNTIME=1 for Managed Agents.
```

---

## Roadmap

Build was sequenced into five demoable, de‑risking phases, plus a **local‑first real‑data** pass that made it run for real — full detail in **[TASKS.md](./TASKS.md)**:

1. ✅ **Foundations** — monorepo, design system, mission‑control shell, data model + RLS, auth, mock realtime, frozen `Event` protocol, cost‑ledger & cache seams.
2. ✅ **The Loop Engine** — one loop runs a full real cycle: agent roster, artifacts/Git, independent grader, model tiering + caching, budget enforcement (over the `LoopAgentRuntime` seam).
3. ✅ **The Live Dashboard** — the whole cockpit wired to a real loop over a reconnect‑safe realtime spine (`EventStream` → SSE/WS, resume‑by‑`seq` + dedupe); the no‑progress detector + manual single‑step.
4. ✅ **Hierarchy & Meta‑Loop** — L1–L4 trees, CEO coordination (Batch reviews), scheduling, rolled‑up health; concurrency/cadence + irreversible‑action gating + org‑wide cap enforced here.
5. ✅ **Production Hardening** — the four gates **enforced** (Health % = rolling gate‑pass rate), full cost suite (caching audit + Fable‑5 cost gate + per‑org budget dashboard), append‑only tamper‑evident history, alerting, multi‑tenancy/RBAC + multi‑role UI, prod K8s + launch runbooks.
6. ✅ **Local AI + Real Data** — the loop actually **thinks**: pluggable agent runtimes (**Ollama** local · **Claude** Messages API · Fake · CMA) behind the one seam, with the `$0` `ollama-local` sentinel for correct local billing; a **Settings → AI Provider** picker (live Ollama model dropdown / Claude key); **SQLite‑persisted** loops + event history; all demo fixtures removed for honest empty‑states; live **cost/token meters** + **toasts**. The durable Temporal path shares the same provider selection.

---

## Glossary

| Term | Definition |
|---|---|
| **Loop** | An autonomous department that owns a mission and runs the lifecycle cycle indefinitely. |
| **Department** | User‑facing synonym for a Loop. |
| **Mission** | The durable, single objective a loop exists to achieve. |
| **Agent** | A specialized role inside a loop (Planner, Executor, QA, Docs, Reviewer, Coordinator). |
| **Subagent** | An ephemeral, narrowly‑scoped worker an agent spawns for fan‑out. |
| **Artifact** | A file‑as‑memory output (`README/TASKS/HANDOFF/REPORT/STRATEGY`, source). |
| **Memory** | A loop's accumulated, searchable context (artifacts + distilled insights). |
| **Cycle** | One full PLAN→EXECUTE→EVALUATE→IMPROVE→MEMORY traversal. |
| **Tick** | One engine‑driven advance of the state machine. |
| **Gate** | A check‑and‑balance control (Quality, Data Validation, Alignment/Risk, Performance). |
| **Meta‑Loop / CEO** | `loop ceo` — the root loop that supervises all departments. |
| **Commander** | The human operator / admin who runs the cockpit and holds the kill switch. |

---

<div align="center">

**ONE WORD TO RUN IT ALL.**
`loop <anything>` = a department that thinks, acts, and improves.

</div>
