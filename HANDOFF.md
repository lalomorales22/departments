# ◈ DEPARTMENTS — HANDOFF

> The cross-cycle memory of this repo's own `loop software-builder`. **MEMORY is the only legal handoff between cycles** — the next PLAN reads this first. Keep it truthful and current.

- **Cycle:** 6 (Local AI + Real Data) + the **UX track — Phase 7 (Live Run Feedback) + Phase 8 (Information Architecture) + Phase 9 (Members & Integrations)** — all shipped · **post-ship fix (2026-06-27):** live SSE delivery — a running loop now actually renders (was silently dark)
- **Updated:** 2026-07-01
- **Repo:** 🌐 **PUBLIC on GitHub** → https://github.com/lalomorales22/departments · default branch **`main`** (account `lalomorales22`). Phases 1–7 + the live-SSE fix are on `main` and pushed. **Phases 8–9 (the rest of the UX track) are now on `main` and pushed too** (commit `5917d99`, fast-forwarded from `phase-8-9-information-architecture`; all in `apps/web` + the docs). Working tree clean. (Heads-up: Phase 7 `21540d2` had been **local-only** until 2026-06-27 — pushed then alongside the fix `ebea5bd` + a README nit `27356e1`, range `f4a0af5..27356e1`.) Working tree clean. `origin` = `https://github.com/lalomorales22/departments.git`; `main` tracks `origin/main`.

---

## ⏱ Current state — read this first

**The platform runs for real, locally, with no cloud and no Docker.** `loop <name>` in the cockpit creates a real, persisted department; you pick a model in **Settings → AI Provider** (local Ollama or Claude); a real model streams a genuine **PLAN → EXECUTE → EVALUATE → IMPROVE → MEMORY** cycle into the console; real artifacts + memory land in `.volumes/`; loops + full event history persist in **SQLite** and survive restart. Local Ollama runs at **$0**.

**Phase 8 (Information Architecture) is done** — the cockpit now has two modes. **ORG view** (the landing): the six top tabs aggregate across ALL loops — a fleet **DASHBOARD** of loop cards, org **AGENTS**/**TASKS** rollups, the cross‑loop **ARTIFACTS** browser, **ANALYTICS**, **SETTINGS**. Clicking a loop (hierarchy, a card, the command bar, or the palette) enters **LOOP view** — that loop's own workspace page (header, live pipeline, agents, task board, metrics, console) with a `← Org` breadcrumb back. Selecting any top tab returns to ORG. The right **Inspector** is now ONE scrolling page (Details/Config/History stacked; an org summary in ORG view) and is **drag‑resizable + collapsible** (width persisted). **⌘N/⌘A/⌘T** open dedicated **creation modals** (New Loop is fully backed → a persisted department; New Agent/New Task are loop‑scoped with honest state) instead of falling through to ⌘K search.

**Phase 9 (Members & Integrations) is done** — **Members** is now REAL: the SQLite `members` table (in `lib/server/db.ts`) seeds only the local commander, and Settings → Members supports **add** (name/email/role) + **delete** (server-guarded: never yourself or the last owner) + role change, all persisted via `/api/org/members` (+ `/[id]`) and mirrored client-side by `lib/members-client.ts`. Role options are gated by `canAssignRole` (members admin is Owner-only, so a Commander sees a read-only roster). **Integrations** now tells the truth: **Ollama** pings the daemon and shows CONNECTED + model count (or NOT REACHABLE), **Claude** shows CONFIGURED once a key is set, and CMA/Temporal/Redis/Postgres read **"NOT CONFIGURED · DOCKER/CREDS"** in a muted style (not alarmist), each with a one-line reason.

**Verified (Phases 8 + 9):** `@departments/web` typecheck + `next lint` + `next build` all clean; prod server serves `/` (200), and the loop + members CRUD routes work end-to-end (seed roster = just the commander; add/patch/delete + the self/last-owner 409 guards all confirmed via curl; DB left clean). *(Browser eyeball still blocked — the Claude‑in‑Chrome extension can't reach a local dev server; unchanged caveat.)*

- **Verified:** 13/13 packages typecheck · 11 packages' unit tests pass · `next build` + `next lint` clean · real cockpit runs drove `qwen3.5:2b` (and `gemma4:12b-it-qat`) through all five phases (incl. a real rework) at **$0**, with events persisted and per-role models routed correctly.
- **Untested:** the **Claude** provider is code-complete but has never run (no API key on this machine). CI on GitHub hasn't been observed green yet.
- **Gated (authored, not exercised here):** the whole prod data plane — Postgres/pgvector, Redis, Temporal, MinIO, the NestJS gateway, real CMA + Vaults. These need `docker compose up -d` and/or creds.
- **Post-ship fix (2026-06-27, `ebea5bd`) — the live cockpit now actually renders a run.** A latent bug sent engine events on a *named* SSE channel (`event: <kind>`) while the client listens only on `EventSource.onmessage` (the default channel), so a running loop showed **"warming up · 0 tokens"** with a frozen pipeline even though the engine + EventStream + SQLite all worked. Now emitted on the default channel. **Verified end-to-end** vs the live dev server: 99 events delivered to `onmessage`, tokens ticking, all five phases streamed, run completed to idle (Ollama `qwen3.5:2b`). Resolves the old line-30 caveat.

### ▶ Run it right now

```bash
pnpm install
# (optional) install Ollama + pull a tool-capable model: ollama pull gemma4:12b-it-qat
pnpm --filter @departments/web dev          # cockpit → http://localhost:3000
#  Settings → AI Provider → pick an Ollama model (or add a Claude key)
#  command bar:  loop marketing   then   run marketing   (or hit ▶)
```
Headless CLI: `DEPARTMENTS_PROVIDER=ollama OLLAMA_MODEL=gemma4:12b-it-qat pnpm --filter @departments/orchestration exec tsx src/cli.ts marketing --stream --cycles 1`

> ✅ **Cockpit live view — RESOLVED (2026-06-27).** The old "never eyeballed in a browser" caveat is closed: a latent SSE-channel bug (above) kept the live UI dark; fixed in `ebea5bd` and verified end-to-end. **Now binding:** keep DeptEvent SSE frames on the DEFAULT channel — see the Cycle-6 watch-outs below. (Aside, found while testing: the Claude-in-Chrome browser resolves `localhost:3000` to an unrelated app, so the in-browser eyeball was done via a faithful `onmessage` client against the real dev server, not the extension.)

---

## ✅ Cycle 6 — what shipped (all in commit `bbc07af`, on `main`)

### Real model runtimes (the loop now THINKS)
- **`@departments/agent-runtime`** — a shared `CompletionLoopRuntime` base (`completion-runtime.ts`: per-phase prompts → real artifacts in the git tree, streamed `output` events, an independent four-gate JSON grader) with two real providers:
  - **`OllamaRuntime`** (`ollama.ts`) — streams `localhost:11434/api/chat`, **$0**, sends **`think:false`** (thinking models otherwise spend their whole budget reasoning and return EMPTY content). Verified a no-op on non-thinking models.
  - **`ClaudeRuntime`** (`claude.ts`) — the Anthropic **Messages API**, direct (no SDK). Sends only `{model, max_tokens, system, messages}` — no temperature/thinking/budget knobs (the params that 400 on Opus/Fable). **Untested without a key.**
- **`FakeCmaRuntime`** stays the deterministic offline runtime (demos/tests). The four implement the SAME `LoopAgentRuntime` contract.
- **Provider selection is DRY in `provider.ts`:** `providerConfigFromEnv()` / `runtimeFromConfig()` / `runtimeFromEnv()`, env `DEPARTMENTS_PROVIDER` · `OLLAMA_BASE_URL` · `OLLAMA_MODEL` · `OLLAMA_ROLE_MODELS` (JSON) · `ANTHROPIC_API_KEY` · `CLAUDE_MODEL`. Consumed identically by the **CLI** (`orchestration/cli.ts`) AND the **durable Temporal worker** (`apps/orchestrator/activities.ts` `selectRuntime`/`roleModels`).
- **Billing correctness (critical):** added an **`ollama-local` sentinel `ModelId`** — role **`local`**, *outside* the worker→executor→judgment→strategy escalation ladder, **$0** in `models.ts` `MODEL_TIERS` + `cost/ledger.ts` `PRICE_TABLE`. `providerRoles(cfg)` pins every role to it for Ollama. **Without this the engine bills local tokens at the Opus/Sonnet tier and trips the budget cap.** Verified an *escalating* Ollama run still bills $0 (the sentinel can't bump to a paid tier).
- **Per-role Ollama models:** `resolveCallModel(modelId, role)` (base signature now takes the role); `OllamaRuntime({ roleModels })` picks a different model per role; Settings has a **default model + 4 per-role dropdowns** (planner/executor/reviewer/docs). Verified end-to-end: a run with `reviewer→gemma4:12b-it-qat` used the default `qwen3.5:2b` for PLAN/EXECUTE/MEMORY and gemma for EVALUATE, $0.

### Real persistence (SQLite — no Docker)
- **`apps/web/lib/server/db.ts`** (`node:sqlite`, single file `.volumes/departments.db`, single-writer from the Next server). Tables: **`loops`** (the registry) + **`events`** (full per-loop stream). The run route persists every ingested event and **folds terminal status/health/cycle/spend onto the loop row** (parses the engine's completion-log cost), so state survives a restart. Git artifacts + JSONL memory still live on disk.
- Routes: **`GET/POST /api/loops`**, **`GET/PATCH/DELETE /api/loops/:id`** (PATCH now **really writes** cadence/mission/displayName/budget), **`GET /api/ollama/models`** (proxies `/api/tags`).

### De-mocked cockpit (fixtures removed)
- **`lib/loops-client.ts`** — a reactive zustand loop registry hydrated from `/api/loops` (`useLoops`/`useLoopById`/`useLoopTree`/`useLoopRegistry`), replacing `fixtures/loops.ts`. **`lib/workspace.ts`** — a real `LOCAL_ORG`/`LOCAL_COMMANDER` (single local workspace). **`lib/roster.ts`** — `useAgentRoster` builds the roster from the ACTUAL provider/model selection (so the agent grid shows your Ollama models, not Claude tiers).
- The other fixtures (`tasks/metrics/logs/memory/artifacts/gates`) are emptied to **honest empty-states**; `agents.ts` exposes the real canonical roster (planner/executor/reviewer/docs). Inspector reads real artifacts/memory via `/inspect` once a loop has run. `loop <name>` creates a real persisted department; an empty workspace shows a "create your first department" hint.

### Cockpit instrumentation + UX
- **Settings → AI Provider** pane (`SettingsView.tsx`): provider radio, Ollama base URL + live model dropdown + Test connection + per-role dropdowns, Claude key field. → `store.providerConfig` (persisted) → sent in the `runLoop` POST body → forwarded as subprocess env by the run route.
- **`LoopHeader`**: a provider/model badge + live **Cost/Tokens** readouts. The engine emits cumulative **`cost_usd` + `tokens`** `metric` events (frozen kind — NO protocol bump) → `useLiveUsage` drives the header + auto dashboard cards.
- **Toasts** (`lib/toast.ts` + `shell/Toaster.tsx`) replace swallowed fetch errors (loop create, run failure, already-running, cadence edit). The SSE connection dot already lived in `StatusBar`.

---

## 🔜 Next up — UX & Information Architecture (3 phases · full detail in `TASKS.md` Phases 7–9)

The platform **runs**, a running loop is **legible** (Phase 7), it's **well-structured to use** (Phase 8), and Settings **reflects reality** (Phase 9). **The whole UX track (Phases 7–9) is now shipped** — next work is the backlog below (test Claude · make CI green · the prod data plane · web gaps).

- **Phase 7 — Live Run Feedback. ✅ SHIPPED** (`21540d2`; made to actually render by the live-SSE fix `ebea5bd`). The loop-pipeline cards show per-phase progress — the active PLAN→EXECUTE→EVALUATE→OPTIMIZE→MEMORY stage fills/pulses, "phase n of 5" + cycle N/M — with a live elapsed/tokens/streamed-line strip under the pipeline. Pipeline = `apps/web/components/center/LoopPipeline.tsx`; progress derives from the live feed (`lib/live.ts` `useLivePipeline`).
- **Phase 8 — Information Architecture. ✅ SHIPPED** (working tree, uncommitted). ORG ↔ LOOP modes via `store.viewMode` (`enterLoop`/`backToOrg`); `CenterColumn` routes on it. Org aggregates in `components/center/OrgView.tsx` (fleet dashboard `LoopCard` grid + org agents/tasks; ARTIFACTS reuses the cross-loop browser). Per-loop workspace = `CenterColumn` `LoopWorkspace` + `← Org` breadcrumb. Inspector merged to one scroll + `ResizeHandle` in `AppShell` (`store.rightWidth`). Creation modals = `components/command/CreationModals.tsx`, wired from `KeyboardChords`/`QuickActionList`/palette. **The six top tabs are the ORG lens — `setTab` always sets `viewMode:'org'`.**
- **Phase 9 — Members & Integrations. ✅ SHIPPED** (`5917d99`, on `main`). Fake members gone; the SQLite `members` table (seeded with just the local commander) backs real add/delete/role via `/api/org/members` + `lib/members-client.ts`, role-gated by `canAssignRole` with self/last-owner delete guards server-side. Integrations relabeled honestly with a live Ollama daemon ping. See `TASKS.md` Phase 9.

> To pick up in a fresh chat: read this file, then the backlog below. The UX track (7–9) is done and on `main`; the two obvious quick wins are **test the Claude provider** (needs a key) and **make GitHub CI green**.

## 🗄 Later — prod data plane & cloud (backlog, after the UX phases)

### A. Quick wins
1. **Test the Claude provider.** Add an `sk-ant-…` key in Settings → AI Provider (or `ANTHROPIC_API_KEY` env), run a loop, confirm it streams + the cost meter shows non-zero. The runtime is `claude.ts`; if the Messages API shape needs an adjustment (e.g. an `output_config.effort` or a beta header), this is where. Consider streaming SSE for Claude (currently non-streaming, chunked into `output` events).
2. **Make CI green on GitHub.** `.github/workflows/ci.yml` now runs on push/PR. Watch the first run, add any needed setup (it should be typecheck + lint + test + `next build`), fix anything red, and confirm the badge.
3. **(optional) Push the phase branches.** `main` already contains all their commits; `phase-2…phase-6` are local-only. Push for reference if wanted, or delete them.

### B. Web gaps (toward a polished product)
4. **Tasks board projection.** The Kanban is an honest empty-state — there's no real tasks source. Build a projection from the loop's `TASKS.md` (or from phase/run events) into board cards. (Frozen `Event` protocol: do it as a derived view or a local `task` table, not a new event kind.)
5. **Member-role edits.** `SettingsView` MembersPane PATCHes `/api/org/members/:id` which isn't implemented locally (optimistic swallow). Either implement a local members store or make it clearly local-only.
6. **Alerts surface.** Engine alerts (`@departments/shared/alerts`) are raised engine-side + logged, but there's no cockpit banner. Add a patch channel (NOT a protocol bump) → a dismissible alerts surface.
7. **ANALYTICS on real data.** It still synthesizes a health series when no live `health` is present, and the budget dashboard reads a client rollup over the registry. Wire it to persisted `gate_pass_daily`/`org_health_daily` (prod) or to the SQLite event history (local).
8. **Activity map + screenshot transport** are labeled stubs (no geo source / no real screenshots). Wire real sources or keep clearly labeled.
9. **a11y + responsive audit** — focus rings, keyboard nav on the tree/palette, prefers-reduced-motion, contrast, narrow widths.
10. **(nice-later) Per-loop provider/model config.** Today provider/model is global (one selection for all loops). Could move it per-loop (write into the loop's `roles`).

### C. Prod data plane — the big lift (Docker + Postgres + Temporal)
11. **Bring up the stack:** `docker compose up -d` (Postgres+pgvector · Redis · Temporal · MinIO).
12. **Implement the migration runner** — `pnpm db:migrate` is an **echo stub** (`packages/db/package.json`). Write a real runner that applies `sql/0001`→`0006` (+ `0100` if present), then run the RLS test doc **§A–§G** green and confirm the immutability triggers + `rls_violation_audit` (must be empty). Create a **non-superuser app role** so `FORCE RLS` is meaningful. Reconcile **`packages/memory/src/pgvector.ts` schema drift** vs `0001/0002`.
13. **Drive the durable path:** run the Temporal worker (`apps/orchestrator`) + a real `loopWorkflow`/`ceoWorkflow`; confirm cadence-aware `IDLE_WAIT`, continue-as-new, and idempotency.
14. **Connect the cockpit to Postgres (multi-tenant).** Today the cockpit reads its own local SQLite; the gateway `GET /loops` returns `[]` (`apps/gateway/src/app.controller.ts`). Implement the gateway resolvers + `OrgContextPool`, and decide the local-SQLite ↔ prod-Postgres relationship (likely: SQLite = single-user local, Postgres = hosted multi-tenant).

### D. Real CMA (Anthropic Managed Agents)
15. **Wire a concrete CMA client.** `cma.ts` is typed + unit-tested but lacks a real HTTP client for `client.beta.{agents,sessions,outcomes}`. Build it, then `runtimeFromConfig` can return a real `CmaRuntime`. Add CMA to the provider selector (`provider.ts`) alongside ollama/claude/fake.
16. **Exercise with creds:** `USE_CMA_RUNTIME=1` + key → `CmaRuntime` + `CmaVault` + the **Fable refusal-safe** path + Scheduled Deployments; verify prompt-cache reads are non-zero and the Batch 50% holds.

---

## ✅ Cycles 1–5 — what's already done (summary)

All complete and on `main`. Phase 1 **Foundations** (monorepo, design system, cockpit shell, data model + RLS, frozen `Event` protocol, cost/cache seams). Phase 2 **The Loop Engine** (a real cycle over hexagonal ports talking only to `LoopAgentRuntime`; real git artifacts; independent grader; model tiering; budget enforcement). Phase 3 **The Live Dashboard** (`@departments/realtime` spine — `EventStream` + resume-by-`seq`/dedupe + reconnect; SSE local transport + authored WS gateway; no-progress detector + manual single-step). Phase 4 **Hierarchy & Meta-Loop** (L1–L4 trees, CEO Batch reviews, scheduling, rolled-up health, concurrency/cadence + irreversible-action gating + org-wide cap). Phase 5 detail below.

### Phase 5 — Production Hardening (detail kept; still load-bearing)
- **Four gates ENFORCED + Health % = rolling gate-pass rate** (`@departments/rubrics/gates.ts`): `GateThresholdConfig`/`PHASE_GATES`/`enforceBoundary`/`gatePassRate`/`rollingHealth`/`HealthController` (scores 0–100). `engine.ts` rolls health from `verdict.gates`, raises a barrier that SKIPS IMPROVE on any failing required gate (records the failed cycle to MEMORY), and **emits the canonical `health` metric itself** at the cycle boundary; the driver no longer double-emits it. `CycleResult` has `gates`/`health`/`gateBlocked`.
- **Cost finalized** (`@departments/cost`): `CacheAuditor` (mid-life cache degradation), `orgReport` (per-org budget dashboard), `requiresFableApproval`+`projectedCycleUsd` (Fable-5 cost gate → unapproved downgrades to Opus), `batchSavings`; `models.ts` `LOCKED_ROLE_EFFORT`+`validateLockedEffortPolicy`.
- **Tamper-evidence:** `@departments/events/audit` (sha256 hash-chain SIDECAR — separate subpath, uses `node:crypto`) + `db/sql/0006_audit.sql` (immutability triggers purge-gated by `app.allow_purge`, `audit_log`, `rls_violation_audit`/`caching_audit`/`gate_pass_daily` `security_invoker` views; RLS doc §G).
- **Alerting** (`@departments/shared/alerts`): `AlertBus` + `RefusalStormDetector` + `StreamHealthMonitor`; engine/driver raise budget/gate/cache/Fable/tool/no-progress; mirrored in `infra/k8s/alerting.yaml`.
- **Security** (`agent-runtime/{security,vault}.ts`): secret scan/redact/`assertNoSecrets`, `wrapUntrusted` content fencing, `limited` deny-by-default networking, `VaultRef`+egress injection. **Gateway** `RbacGuard`+`@RequireCapability`+`AuthMiddleware`+`OrgContextInterceptor`.
- **Multi-role** (`@departments/shared/rbac.ts`): `RBAC_MATRIX` (owner⊇commander⊇operator⊇viewer), `can`/`canAssignRole`. Cockpit role switcher + capability-gated transport/approvals + the full `SettingsView`.
- **Infra:** `infra/k8s/production.yaml` (HPA/PDB/secrets) + 7 `docs/runbooks/`.

---

## ⚠ Watch-outs (don't break these)

### Phase 9 (Members & Integrations)
- **The `members` table seeds ONLY the local commander, lazily.** `listMembers(orgId)` inserts `LOCAL_COMMANDER` when the org has zero rows (first read) — don't seed demo people anywhere, and keep `LOCAL_COMMANDER` (`lib/workspace.ts`) as the single seed identity. `db.ts` now imports `@/lib/workspace` (server-safe: types + consts only — never import a client store into `db.ts`).
- **Two delete guards are server-authoritative** (`deleteMember` → 409): never remove `user-local` (yourself) or the last `owner`. The UI disables those trash buttons, but the route is the real gate — keep both.
- **Members admin is Owner-only** (`members.manage`/`role.assign` in the RBAC matrix). The default acting role is `commander`, which sees a READ-ONLY roster (no add form, disabled role selects) — that's correct, not a bug. Switch to Owner via the role switcher to manage. Role pickers only offer roles strictly below the actor (`canAssignRole`) — don't widen them.
- **Integrations status is honest, not decorative.** Ollama is a LIVE ping of `/api/ollama/models` (CONNECTED / NOT REACHABLE); Claude reads `providerConfig.anthropicApiKey`; CMA/Temporal/Redis/Postgres are the muted `gated` state ("NOT CONFIGURED · DOCKER/CREDS"), NOT red/broken. The local app holds no secrets — don't reintroduce fake `vault://…` "connected" credentials.

### Phase 8 (Information Architecture)
- **The six top tabs ARE the ORG lens.** `store.setTab` sets `viewMode:'org'` on every call — selecting a tab always shows the whole-org aggregate and exits any loop workspace you'd drilled into. Don't add a tab path that expects to stay in LOOP view.
- **`enterLoop` vs `setSelectedLoop`.** `enterLoop(id)` selects a loop AND switches to LOOP view (use it for every user drill-in: tree, cards, command bar, palette, deep-link). `setSelectedLoop(id)` only changes the selection WITHOUT switching view — it exists so `AppShell`'s hydrate effect can pick a valid loop while staying in ORG. Keep that split.
- **Org aggregates read the registry, per-loop reads the live overlay.** `OrgView`/`OrgInspector` aggregate `useLoops()`/`useLoopTree()` (last-persisted rows); the LOOP workspace + header still layer the live SSE overlay (`lib/live.ts`) for the *selected* loop only. `rosterForProvider(loopId, cfg)` is the NON-hook roster builder — used inside the `OrgAgents` map (never call the `useAgentRoster` hook in a loop).
- **The inspector is one scroll, not tabs.** `inspectorTab` was removed from the store; `InspectorPanel` stacks Details/Config/History and branches on `viewMode` (org summary vs per-loop). Right-sidebar width is `store.rightWidth` (clamped 280–560, persisted) driven by `AppShell`'s `ResizeHandle`.
- **⌘N/⌘A/⌘T are their own modals now** (`CreationModals.tsx`), NOT the ⌘K palette. New Loop is the only fully-backed one (creates a persisted department + `enterLoop`s it); New Agent routes to Settings→AI Provider (the roster is provider-derived, not per-agent), New Task is honest that task persistence isn't wired (backlog item B4).

### Cycle 6
- **Live SSE MUST ride the DEFAULT channel (2026-06-27, `ebea5bd`).** The cockpit client (`apps/web/lib/realtime.ts`) listens ONLY on `EventSource.onmessage`, which fires solely for default/unnamed SSE events. The stream route (`apps/web/app/api/loops/[id]/stream/route.ts`) MUST send each DeptEvent as an `id:` + `data:` frame with **NO `event: <kind>` line** — naming the frames routes them to per-kind `addEventListener` the client never registers, so nothing renders (latent since Phase 3; masked by fixtures until Phase 6 de-mocked the cockpit). The `kind` already rides in the JSON; `id:`/seq still drives Last-Event-ID resume; the `event: open` metadata frame staying named is fine (the client ignores it).
- **The `ollama-local` $0 sentinel is billing-critical.** It's role `local` (OUTSIDE the escalation ladder) and $0 in BOTH `agent-runtime/models.ts` MODEL_TIERS and `cost/ledger.ts` PRICE_TABLE. `providerRoles(cfg)` pins every role to it for Ollama. Don't "fix" the agent-runtime closed `ModelId` union by adding real Ollama model names — the model name rides on the runtime instance; the union stays Claude-shaped + the sentinel.
- **One provider seam, two consumers:** `provider.ts` (`runtimeFromConfig`/`providerRoles`) drives BOTH `orchestration/cli.ts` and `apps/orchestrator/activities.ts`. Keep them in sync — don't fork the per-role binding.
- **`node:sqlite` is server-only.** `lib/server/db.ts` runs only in Next route handlers (`runtime = 'nodejs'`). Never import it into a client component or the browser bundle breaks.
- **Ollama thinking models need `think:false`** or `message.content` comes back empty (the budget is spent on `thinking`). The runtime also falls back to `thinking` text if content is empty.
- **Pushing requires the `workflow` gh scope** (the repo has `.github/workflows/ci.yml`). If a future push of workflow changes is rejected, run `gh auth refresh -h github.com -s workflow`.

### Carried from Phase 5 (still binding)
- **`@departments/events/audit` is a SEPARATE subpath** — uses `node:crypto`; MUST NOT be re-exported from the events barrel or the Next/webpack browser bundle breaks. Webpack-consumed packages (shared/events/realtime/web) use **extensionless** relative imports (moduleResolution `Bundler`); orchestration/cost/agent-runtime stay `.js` (node-run).
- **The frozen `Event` protocol (v1) is binding.** No new kinds were added — gate/health/alert/cost/token signals all reuse `metric`/`log`/`status`; tamper-evidence is a sidecar. Keep it that way (a tasks/alerts patch channel is a separate, non-protocol addition).
- **Health is engine-owned** (rolling gate-pass rate), emitted once per completed cycle; `gateBlocked` uses the full four-gate `enforceBoundary('evaluate')`.
- **Precedence is binding:** cost caps + human gates OVERRIDE escalation; the Fable gate governs *which model*, never whether the loop runs. An **unregistered org cap means uncapped**.
- **RBAC is one matrix, two enforcers** (`@departments/shared/rbac`): cockpit (cosmetic) + gateway `RbacGuard` (authoritative). Don't fork it.
- **`0006` immutability** blocks UPDATE/DELETE on the spines unless `app.allow_purge='on'` — the per-request gateway role must NEVER set it; only the privileged retention/admin role does.
- **`.volumes/`** (per-loop git repos + memory + the SQLite DB) is gitignored runtime state — never commit it. The local DB starts empty.
