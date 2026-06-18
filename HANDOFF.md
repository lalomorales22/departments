# ◈ DEPARTMENTS — HANDOFF

> The cross-cycle memory of this repo's own `loop software-builder`. **MEMORY is the only legal handoff between cycles** — the next PLAN reads this first. Keep it truthful and current.

- **Cycle:** 4 (Phase 4 — Hierarchy & Meta-Loop)
- **Updated:** 2026-06-17
- **Status:** ✅ Phase 1 (Foundations) + Phase 2 (Loop Engine) + Phase 3 (Live Dashboard) + Phase 4 (Hierarchy & Meta-Loop) complete. One loop became **"loops all the way down"**: a **CEO meta-loop** coordinates a tree of child loops, and **the runaway/cost/irreversible-action guards are enforced exactly where autonomy first scales** — the org-wide hard cap, concurrency semaphore, cadence floors, `always_ask`, child-spawn approval, and the budget-vs-escalation precedence are all live. Redis/Temporal/CMA/Postgres paths are authored + gated behind Docker/creds.

---

## Phase 4 — what shipped

### Engine guardrails — `packages/orchestration/src/engine.ts` (+ `@departments/cost`)
- **Org-wide hard budget cap + precedence.** `LedgerPort` gained `checkOrgCap` + `headroomUsd`/`orgHeadroomUsd`; the engine takes the **stricter** of the loop and org cap (`stricterAction` in cost) — a tree of loops each under its own cap still pauses when their **combined** spend breaches the org cap. **Fix:** an *unregistered* org now reads `ok` (uncapped), not `hard` (`orgStatus`), so merely scoping an `orgId` no longer pauses everything.
- **Data-driven escalation, SUBORDINATE to caps** (`escalation.ts`, pure + tested). Repeated grader failure bumps the rework executor's capability (`escalateOneTier`), decaying on a clean pass — but **refused** whenever the stricter cap is not `ok` (soft-downgrade wins) or the bump wouldn't fit the hard-cap headroom (`estimateCallCostUsd`). `CycleResult.escalated`.
- **`always_ask` on irreversible tools** (`tool-gate.ts`). The runtime raises a `ToolConfirm` for a deploy/send/spend/delete tool (`isIrreversibleTool`); the engine routes it through a `ToolGate` (auto-approve / `denyToolGate` / `ManualToolGate`), emitting `tool_use` start→result/error and a guardrail log; a denial **reroutes** (never pauses the loop). `CycleResult.toolDenied`.

### Runaway guards — `packages/orchestration`
- **Concurrency semaphore** (`semaphore.ts`): `ConcurrencySemaphore` with `InMemorySemaphore` (FIFO, default) + **`RedisSemaphore` gated on `REDIS_URL` + an injected `SemaphoreRedisLike`** (no driver import) + `createSemaphore` factory. The engine acquires a per-org slot around every model session.
- **Cadence floors** (`cadence.ts`, pure): per-tier minimum interval (`cadenceFloorMs`) + `CadenceController`. Enforced opt-in between cycles in `local-driver` (inject `sleep`); the durable form is the Temporal `IDLE_WAIT`.

### Hierarchy — `packages/orchestration`
- **Child-spawn + manual approval** (`spawn.ts`): `SpawnController` enforces **max depth, per-org child cap, queued-spawn cap, and the denial-loop guard** (a denied `(parent,child)` can't be re-requested); `SpawnGate` (auto/deny/`ManualSpawnGate`) is the human approval. `resolve()` is the full pre-flight → approve/deny flow.
- **Health/metric rollup** (`rollup.ts`, pure): per-loop subtree aggregation — mean health, summed spend/budget, worst status (`error>paused>running>idle>stopped`), descendant count, `aggregate()` for org KPIs.

### CEO meta-loop — `packages/orchestration/src/ceo.ts` + `@departments/agent-runtime/batch.ts`
- **`planObjectives`** (pure) classifies each child (stabilize/recover/scale/hold) and **reallocates budget net-zero** weakest→strongest. **`setObjective`** writes the child's CEO-owned `STRATEGY.md` (via the new `ArtifactPort.write`), seeds its memory (so its next PLAN reads it), adjusts its ledger cap (floored at spend), and emits an `objective` event (HISTORY).
- **`runCeoReview`** grades children via the **Batch API path** (`FakeBatchReviewRuntime` + gated `CmaBatchReviewRuntime`; pre-warm + shared cached prefix), priced at **50% off** through `batchCostOfUsage`.
- **`runTreeLocally`** = the local CeoWorkflow: runs every child concurrently on ONE shared ledger + ONE semaphore (org cap + bounded parallelism), then the CEO reviews + reprioritizes + the tree health rolls up. CLI demos: `--tree`, `--ask approve|deny`, `--org-cap <usd>`, `--approvals`.

### Temporal + gateway + provisioning (Docker/creds-gated, authored + typechecked)
- `apps/orchestrator`: **`ceoWorkflow`** (mirrors `loopWorkflow`), **`spawnChildActivity`** (idempotent child `loopWorkflow` start via `WorkflowClient`, populates `parentLoopId`/`level`), **`ceoReviewActivity`** (durable-idempotent `runCeoReview`), and a **cadence-aware durable `IDLE_WAIT`** in `loopWorkflow` (`cadenceFloorMs` → `Promise.race([sleep, condition])`). Determinism preserved (no `Date.now`/`setTimeout`).
- **HMAC webhook → `run_now`**: pure `webhook-hmac.ts` (timing-safe, **7 tests**) + gated `webhook.ts` http receiver that signals `runNow` on `loop-${loopId}`. The gateway gained **no** `@temporalio/client` dep.
- `scripts/provision.ts`: **CMA Scheduled Deployment bridge** (SDK capability probe + raw-HTTP `/v1/deployments` fallback, `managed-agents-2026-04-01`), `schedule`/`cadence` parsing, still gated behind `--apply` + `ANTHROPIC_API_KEY`. `provision-agents.yaml`: the CEO `coordinator` roster now points at the real L1 leads (one hop).

### Data — `packages/db/sql/0005_rollup.sql`
- `loop_tree` (recursive CTE: root/depth/ancestor path) + `loop_rollup` (subtree aggregates) as **`security_invoker` views** (PG15+) so base-table RLS applies transitively; `org_health_daily` **materialized view** for ANALYTICS-over-time (unique `(org_id,day)` index for `REFRESH … CONCURRENTLY`; **app-level org filter required** — matviews can't carry RLS). RLS test doc + README updated.

### Cockpit — `apps/web`
- **`LoopTree`**: rolled-up health per node + worst-status surfacing + **CEO crown (purple)**; the selected loop's LIVE health overlays the fixture rollup (`lib/tree.ts`).
- **ANALYTICS tab** (`AnalyticsView`): org KPIs, aggregate health-over-time sparkline, per-loop comparison, rolled-up resource allocation, **drill-down** to any loop.
- **ARTIFACTS tab** (`ArtifactsView`): cross-loop file/memory browser + file preview + **⌘I Import** (`/api/loops/:id/artifacts` GET content / POST writes+commits); ⌘I wired in KeyboardChords + palette + QuickActions.
- **Cadence editor** (Inspector → `PATCH /api/loops/:id` + optimistic store override); **set_objective + CEO** folded into HISTORY (`useRunTrace`); **`ApprovalBanner`** surfaces pending `always_ask` + child-spawn approvals and posts the verdict to `/api/loops/:id/decide` → engine subprocess stdin (`--approvals` run; `?approvals=1`).

## Verification (this machine, no Docker / no CMA creds)
- **13/13 packages typecheck**; **`next build` + `next lint` clean**; **all unit tests pass** — orchestration **74** (incl. escalation 8, tool-gate 6, semaphore 6, cadence 5, spawn 7, rollup 4, ceo 5, engine.guardrails 7), cost 15, artifacts 8, scripts 16, orchestrator HMAC 7, plus agent-runtime/events/realtime.
- **End-to-end via the CLI:** an **org-cap** run pauses **org-driven** (loop cap still ok); **`--ask deny`** blocks an irreversible `github.deploy` (reroute, `TOOL-DENIED`) and **`--ask approve`** lets it through; a rework **escalates** when caps are ok and is **refused** under soft-cap/headroom; **`--tree`** runs CEO→marketing+sales on a shared org cap + semaphore, batch-reviews (50%), **reallocates +$20/−$20**, and rolls health up; **`--approvals`** with `spawn:allow|deny` + `tool:allow|deny` exercises both approval gates end-to-end.

## Known gaps / explicitly deferred
- **No Docker here:** `RedisSemaphore`, the Temporal `ceoWorkflow`/`loopWorkflow` + activities (spawn/review/IDLE_WAIT), CMA Scheduled Deployments + the HMAC webhook **delivery**, the Postgres rollup views, and the gateway are authored + typechecked but exercised only under `docker compose up -d`. The local cockpit/CLI use in-memory adapters + the FakeCmaRuntime.
- **Real CMA still gated:** `CmaBatchReviewRuntime` + `selectRuntime(USE_CMA_RUNTIME)` + `applyPlan(--apply)` throw loud NotImplemented without creds.
- **Cockpit rollup is client-side over fixtures** — only the SELECTED loop has live health; unselected descendants use fixture health (the Phase-3 subscription gotcha). Prod reads `loop_rollup` over the gateway.
- **Web approvals path** drives the local single-loop CLI subprocess via stdin (`/decide`); production routes approvals through the gateway + Temporal signals. The `set_objective` event surfaces in a child's HISTORY only once that child has a live subscription.
- `.volumes/` (per-loop git repos + memory) is gitignored runtime state; `p4-*` demo loops are cleaned up.

## Next PLAN should start here (Phase 5 — Production Hardening)
1. **Cost, finalized + swept on evals:** lock per-route effort, maximize Batch coverage, audit caching (alert on ~0 cache reads incl. mid-life degradation), per-org budget dashboard, gate Fable-5 behind cost approval.
2. **The four gates as enforced guardrails** at phase boundaries (PLAN→Alignment; EXECUTE per-unit Quality+Data; EVALUATE all four; Performance→IMPROVE); **Health % = rolling gate pass rate**; threshold editing in SETTINGS (the disabled sliders are pre-built).
3. **Security/multi-tenancy finished:** CMA Vaults for all creds, `limited` deny-by-default networking, prompt-injection posture, end-to-end RLS audit + cross-tenant pentest, append-only tamper-evident history.
4. **Multi-role UI** (Operator/Viewer, not just Commander); ANALYTICS finished on the real `loop_rollup`/`org_health_daily`; `ActivityGlobe` on real geo signal (or labeled stub); full a11y + responsive; alerting + prod K8s + runbooks.
5. **Housekeeping:** merge the phase branches → `main` (`phase-2` → `phase-3` → `phase-4-hierarchy-meta-loop`); exercise the Docker stack (Redis/Temporal/Postgres/MinIO/gateway) end-to-end.

## Watch-outs
- **Precedence is binding:** caps + human gates OVERRIDE escalation. Keep `stricterAction(loopCap, orgCap)` and the escalation `capAction === 'ok'` + headroom guard intact. An **unregistered org cap means uncapped** (`orgStatus` returns `ok`) — don't "fix" that back to `hard`.
- The **frozen `Event` protocol** (`EVENT_PROTOCOL_VERSION = 1`) is binding. Phase 4 added NO kinds: child-spawn/objective/tool-confirmation reuse `log`/`tool_use`/`status`; rolled health reuses `metric`. A `task` kind / live tree state still needs a separate patch channel, not a protocol bump.
- `ManualToolGate`/`ManualSpawnGate` **bank an early decision** (like `ManualStepGate` credits) so the web `/decide` is order-robust. The web approval path needs an `--approvals` run (`handle.approvals`) or `/decide` returns 409.
- `@departments/orchestration` is **node-run** (`.js` import extensions) and CANNOT cross Next's webpack boundary — the cockpit re-implements the rollup in `apps/web/lib/tree.ts`. Keep the two in sync (same severity order, same mean-health fold).
- `security_invoker` views require **PG15+**; `org_health_daily` (a matview) has **no RLS** — its read path MUST filter `org_id = current_setting('app.current_org', true)::uuid`.
- `ArtifactPort` gained `write` (CEO `STRATEGY.md` + ⌘I import) — every adapter (`GitArtifactStore`, the orchestrator's git store, the in-memory test fake) implements it; keep them in lockstep.
