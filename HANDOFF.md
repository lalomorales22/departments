# ◈ DEPARTMENTS — HANDOFF

> The cross-cycle memory of this repo's own `loop software-builder`. **MEMORY is the only legal handoff between cycles** — the next PLAN reads this first. Keep it truthful and current.

- **Cycle:** 6 (Local AI + Real Data) — shipped
- **Updated:** 2026-06-27
- **Repo:** 🌐 **PUBLIC on GitHub** → https://github.com/lalomorales22/departments · default branch **`main`** (account `lalomorales22`). All six phases are merged to `main` (clean fast-forward) and pushed. Working tree clean. `origin` = `https://github.com/lalomorales22/departments.git`; `main` tracks `origin/main`.

---

## ⏱ Current state — read this first

**The platform runs for real, locally, with no cloud and no Docker.** `loop <name>` in the cockpit creates a real, persisted department; you pick a model in **Settings → AI Provider** (local Ollama or Claude); a real model streams a genuine **PLAN → EXECUTE → EVALUATE → IMPROVE → MEMORY** cycle into the console; real artifacts + memory land in `.volumes/`; loops + full event history persist in **SQLite** and survive restart. Local Ollama runs at **$0**.

- **Verified:** 13/13 packages typecheck · 11 packages' unit tests pass · `next build` + `next lint` clean · real cockpit runs drove `qwen3.5:2b` (and `gemma4:12b-it-qat`) through all five phases (incl. a real rework) at **$0**, with events persisted and per-role models routed correctly.
- **Untested:** the **Claude** provider is code-complete but has never run (no API key on this machine). CI on GitHub hasn't been observed green yet.
- **Gated (authored, not exercised here):** the whole prod data plane — Postgres/pgvector, Redis, Temporal, MinIO, the NestJS gateway, real CMA + Vaults. These need `docker compose up -d` and/or creds.

### ▶ Run it right now

```bash
pnpm install
# (optional) install Ollama + pull a tool-capable model: ollama pull gemma4:12b-it-qat
pnpm --filter @departments/web dev          # cockpit → http://localhost:3000
#  Settings → AI Provider → pick an Ollama model (or add a Claude key)
#  command bar:  loop marketing   then   run marketing   (or hit ▶)
```
Headless CLI: `DEPARTMENTS_PROVIDER=ollama OLLAMA_MODEL=gemma4:12b-it-qat pnpm --filter @departments/orchestration exec tsx src/cli.ts marketing --stream --cycles 1`

> ⚠️ **NOTE on the cockpit page:** verify it renders in a browser at `http://localhost:3000` (or `http://127.0.0.1:3000`). In the build session the page served 200 via curl and every API worked, but a visual screenshot check was blocked by a sandbox boundary — so a human eyeball pass on the UI is still worth doing.

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

The platform **runs**; the next work makes it **legible and well-structured to use** (driven by hands-on feedback). Build in order — **Phase 8 is the heaviest** (it reframes where everything lives), so the quick, high-value Phase 7 goes first.

- **Phase 7 — Live Run Feedback.** A running loop currently says "Running" but *looks* idle. Add a **progress indicator on the loop-pipeline cards** — the active PLAN→EXECUTE→EVALUATE→OPTIMIZE→MEMORY stage fills/pulses, with "phase 3/5" + cycle N/M — and surface elapsed/tokens/streaming output so it's obviously alive. Pipeline = `apps/web/components/center/LoopPipeline.tsx`; progress derives from the live feed (`lib/live.ts` `useLivePipeline`).
- **Phase 8 — Information Architecture (the restructure).** Make the **6 top tabs a whole-org mega-dashboard** (aggregate ALL loops); clicking a loop in the left hierarchy opens **that loop's own workspace page** (its pipeline/agents/tasks/artifacts/history/console). Merge the right **Inspector** (DETAILS/CONFIG/HISTORY) into **one scrolling page**; make the right sidebar **resizable + collapsible**. Wire **New Loop / New Agent / New Task** (⌘N/⌘A/⌘T) to **dedicated creation modals** — today all three fall through to the global-search window (⌘K). Touches `AppShell`, `TabNav`/`CenterColumn`, `LeftRail`/`LoopTree`, `InspectorPanel`, `QuickActionList`/`CommandPalette`.
- **Phase 9 — Members & Integrations.** Drop the **4 default fake members** (Alex/Commander/Sam/Jordan in `SettingsView` `MembersPane`); add real **add/delete member** (persisted), role-gated by `canAssignRole`. Fix the **Integrations** page's "GATED (DOCKER/CREDS)" labels to be honest — **Ollama is live/connected** locally; CMA/Temporal/Redis/Postgres are genuinely gated.

> To pick up in a fresh chat: read this file, then `TASKS.md` Phases 7–9, and start on **Phase 7**.

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

### Cycle 6
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
