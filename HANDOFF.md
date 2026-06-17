# ◈ DEPARTMENTS — HANDOFF

> The cross-cycle memory of this repo's own `loop software-builder`. **MEMORY is the only legal handoff between cycles** — the next PLAN reads this first. Keep it truthful and current.

- **Cycle:** 1 (Phase 1 — Foundations)
- **Updated:** 2026-06-17
- **Status:** ✅ Phase 1 substantially complete and **runnable**. The fixture-bound mission-control cockpit boots at `localhost:3000`; all contracts are frozen; CI gates are green locally.

---

## What shipped this cycle

### Monorepo & toolchain
- Turborepo + pnpm workspaces (`apps/*`, `packages/*`), `tsconfig.base.json`, `turbo.json`, Prettier, `.gitignore`, `.npmrc`.
- **Resolution decision:** the whole monorepo uses `moduleResolution: "Bundler"` + **extensionless** relative imports. This is the one setting that satisfies Next/webpack (via `transpilePackages`), tsc, and esbuild/tsx simultaneously. Do **not** reintroduce `.js` extensions or `NodeNext` in app tsconfigs — it breaks the webpack consumption of `@departments/shared`.
- `pnpm-workspace.yaml > allowBuilds` approves `esbuild`/`sharp`/`unrs-resolver` (needed) and declines `@nestjs/core`'s funding postinstall.

### Design system (`apps/web`)
- `app/globals.css` is the **single source of hex** (`:root` tokens: surfaces, hairlines, text ramp, the 6 rationed accents, glows, radii). `tailwind.config.ts` maps semantic names (`bg-surface`, `border-hairline`, `text-accent-*`, `shadow-glow-*`) and **safelists** dynamic accent utilities.
- `lib/status-theme.ts` is the **single status→accent map** (resolves to `var(--accent-*)`, never hex). Glow is reserved for live/selected/focused.
- Geist + Geist Mono self-hosted via the `geist` package; `--font-sans`/`--font-mono` wired; `.tabular` for all machine values.
- Atoms: `StatusDot, StatusBadge, Kbd, TagChip, PriorityBadge, DeltaChip (goodDirection), SectionLabel, TimerDisplay, Sparkline`.

### The cockpit (3-column shell, matches `UI.png`)
- **Shell:** `AppShell` (collapsible left/right, persisted), `AppBar` (wordmark, `TabNav`, command search, `TransportBar`), `StatusBar` (chord rail + live indicator).
- **Left:** `CommandBar` (`> loop <name>`), recursive `LoopTree`/`LoopTreeNode` (CEO/Business/Execution/Worker nesting, live dots), `QuickActionList`, `CommanderProfile`.
- **Center:** `LoopHeader` (+`HealthGauge`, elapsed `TimerDisplay`, budget bar), `LoopPipeline` (PLAN→EXECUTE→EVALUATE→**OPTIMIZE**→MEMORY, cycle counter, AUTO/STEP toggle), `AgentGrid`/`AgentCard`, `KanbanBoard` (5/4/2/4), `MetricGrid`/`MetricCard` (6 metrics, sparklines, delta-by-`goodDirection`), `LogConsole` (LOGS/DEBUG/OUTPUT, agent-scoped), `ActivityMap` (dotted-continent world view).
- **Right:** `InspectorPanel` (DETAILS / CONFIG / HISTORY) — mission, success metrics, gates, artifacts, searchable context/memory, model-tier table, cycle timeline.
- **Command/keyboard:** `CommandPalette` (cmdk: run-loop / navigate / actions), `ShortcutSheet`, `KeyboardChords` (⌘K/⌘P/⌘D/⌘F/⌘E/⌘M/?/1–6/[ ]).
- **Fixtures** (`lib/fixtures/*`) mirror the spec exactly: marketing loop + 16-loop tree, 8 agents (5 running / 3 idle), 15 tasks (5/4/2/4), 6 metrics (Bounce Rate + CAC = `down`), 5 artifacts, 5 memory items, a mixed-kind event stream, geo activity nodes — all current-era (2026) dates. The `get*` selector API mirrors what the gateway will expose, so fixtures → live data is a thin swap.

### Contract packages
- `@departments/shared` — enums, entity types, and the **canonical `PIPELINE`** (engine `improve` ⇄ UI `OPTIMIZE`, accent keys only).
- `@departments/events` — the **frozen Event protocol** (discriminated union over 8 kinds, monotonic `seq` per loop, stable `id`, `(loop_id, seq)` resume cursor, WS topic helpers, normalizer interface defined-not-implemented).
- `@departments/agent-runtime` — the 4-method runtime interface (CMA-vs-self-hosted behind it) + the **model-tier policy table** + `validateKnobs()` + escalation stub. `models.test.ts` is the **(model,knob) CI gate** (55 tests).
- `@departments/cost` — `BudgetLedger` (per-loop + per-org, soft→downgrade / hard→pause), caching helpers, `count_tokens` signature. `ledger.test.ts` (11 tests).
- `@departments/db` — Postgres schema (`0001_init`), pgvector (`0002`), **RLS** deny-cross-org on every tenant table (`0003`), 2026 seed (`0100`), and an RLS policy-test spec.

### Backend stubs & infra
- `apps/gateway` (NestJS bootstrap + `/health`), `apps/orchestrator` (Temporal-host stub), `docker-compose.yml` (Postgres+pgvector / Redis / Temporal / MinIO), `.github/workflows/ci.yml` (typecheck/lint/test/build + the two policy gates), `infra/k8s/*` skeletons, `.env.example`.

---

## Verification (this machine, no Docker)
- `tsc --noEmit` clean across shared, events, web, agent-runtime, cost, gateway, orchestrator.
- `next build` ✅ (route `/` ~151 kB First Load JS); `next lint` ✅ no warnings/errors.
- Vitest: **66 passing** (55 model-policy + 11 ledger).
- Server boots; SSR renders the full cockpit; screenshots match `UI.png`.

## Known gaps / explicitly deferred
- **Docker stack not exercised here** (Docker was installing). `docker compose up -d` + `pnpm db:migrate` is the next manual check.
- Gateway/orchestrator are **compile-only stubs** — no auth/RBAC/GraphQL/WS or Temporal worker yet (Phase 2/3).
- Realtime is mock/SSR only; the CMA-SSE→normalizer→Redis→WS spine is **Phase 3**.
- RLS policy test is documented but needs a Postgres service to actually run (wired in `ci.yml`).
- `next lint` warns it's deprecated (fine for now; migrate to ESLint CLI before Next 16).

## Next PLAN should start here (Phase 2 — The Loop Engine)
1. `LoopWorkflow(loopId)` durable workflow (continue-as-new), state machine + gate routing, idempotent activities.
2. `agent-runtime/cma` — implement the 4 methods against `client.beta.{agents,sessions}` (`managed-agents-2026-04-01`); wire the model knobs exactly (adaptive on Opus/Sonnet; omit effort+adaptive on Haiku; no sampling on Opus/Fable) and ship the **Fable-5 refusal-safe path + smoke test**.
3. `packages/rubrics` + EVALUATE→`user.define_outcome`; the independent Opus grader (no self-grading).
4. `packages/artifacts` (per-loop Git repo, CMA mount), MEMORY → memory store + pgvector.
5. Cost: `cache_control` on the stable prefix + **CI assert `cache_read_input_tokens > 0`**; ledger enforcement live.
6. Frontend: a real `run_now` trigger from the command bar via the partial normalizer.

## Watch-outs for future cycles
- Keep `improve` (engine) ⇄ `OPTIMIZE` (UI) bound only through `@departments/shared` `PIPELINE`.
- No inlined hex; no glow on idle; machine values stay mono+tabular. (Design QA enforced this cycle.)
- Don't pin `(model, knob)` pairs the policy forbids — the CI gate will reject them.
