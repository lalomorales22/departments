# `scripts/` — one-time CMA agent/environment provisioning

This directory holds the **version-controlled, declarative** spec for the Anthropic
Managed Agents (CMA) role agents a loop department runs, plus the loader that validates
and applies it.

> **The load-bearing invariant:** agents are **created once and referenced by ID, never
> rebuilt per tick.** A CMA Agent is a persisted, *versioned* object
> (`{model, system, tools, skills, mcp_servers, multiagent}`). The orchestration engine
> starts a CMA **Session** per loop run and points it at a pre-provisioned agent by
> `{id, version}` — the request path never calls `agents.create`. Per-tick creation
> accumulates orphaned agents, pays create latency for nothing, defeats versioning, and
> blows the prompt cache. This is the **control plane** (`ant`/CLI lane: static YAML,
> applied from CI); **sessions are the data plane**, driven by the engine via the SDK.

## Files

| File | What it is |
|---|---|
| `provision-agents.yaml` | The `ant`-style declarative spec: one Agent template **per role** for a loop department, with the exact model tiering + knob policy. |
| `provision.ts` | A `tsx`-runnable loader: parses the YAML, validates every `(model, knob)` pairing with `validateKnobs` from `@departments/agent-runtime`, prints the plan. Dry-run by default; real apply gated behind `ANTHROPIC_API_KEY` + `--apply` (documented TODO). |
| `provision.test.ts` | Vitest suite proving the shipped spec is policy-clean and that each forbidden pairing is rejected through the same loader. |

## How to run

```bash
# Dry-run: parse + validate the (model, knob) table + print the plan. Touches nothing.
pnpm tsx scripts/provision.ts

# Real apply against CMA — gated behind BOTH the env var AND the flag.
ANTHROPIC_API_KEY=sk-... pnpm tsx scripts/provision.ts --apply
```

- The **dry-run** is the CI gate: it exits non-zero if any agent pairs an unsupported
  `(model, knob)` (a guaranteed-400) or if the gated Fable agent is missing its
  refusal-safe wiring. Run it on every PR that touches the spec.
- The **apply** path (`applyPlan()` in `provision.ts`) is intentionally a documented
  TODO for Phase 2. It will provision via `@departments/agent-runtime`'s CMA adapter
  (`client.beta.{environments,agents}.*` with `managed-agents-2026-04-01`): create/update
  the environment (idempotent by name), then for each enabled agent `agents.create` (or
  `agents.update --version N`), and persist the returned `{agentId, version}` to config —
  **never into the request path.**

Tests:

```bash
pnpm --filter @departments/scripts test
```

## Model-tier rationale

A loop "re-runs constantly," so cost is structural. The roster is tiered so judgment
work runs on Opus, volume execution on Sonnet, mechanical work on Haiku, and only the
hardest gated strategy on Fable 5 — a naive "everything on Opus" design costs ~5× the
tiered one. Order of cost impact: **caching → tiering → batching → effort.** This file
owns *tiering*.

| Role | Model | Effort | Thinking | Why |
|---|---|---|---|---|
| **planner** | `claude-opus-4-8` | `high` | adaptive | Judgment: breaks down work, refreshes `TASKS.md`; also the **coordinator** of the roster (one delegation hop). |
| **executor** | `claude-sonnet-4-6` | `medium` (→`high`, ceiling `max`) | adaptive | Volume execution (code/content/drafts); fans out to subagent threads. |
| **qa** | `claude-sonnet-4-6` | `medium` | adaptive | Tests/reviews quality of produced artifacts. (Not the independent grader.) |
| **docs** | `claude-sonnet-4-6` | `medium` | adaptive | Maintains `README`/`TASKS`/`HANDOFF`. |
| **reviewer** | `claude-opus-4-8` | `high` | adaptive | The **independent grader** — runs EVALUATE in its own CMA Outcome context, scoring the four gates. **No self-grading.** |
| **coordinator** (CEO) | `claude-opus-4-8` | `high` (`xhigh` for hard agentic) | adaptive | Meta/CEO role: coordination, not production. Roster = the L1 department agents (CEO tree wiring lands Phase 4). |
| **strategy** (gated, optional) | `claude-fable-5` | `xhigh` | always-on (param omitted) | Hardest CEO / greenfield only. `enabled: false` keeps it out of the default apply set; opt in behind explicit cost approval. |
| **worker** (example) | `claude-haiku-4-5` | — (omitted) | — (none) | L4 mechanical work (lint/format/classify/simple-test); 200K context; often Batch-API'd. |

Prices ($/1M in · out): Opus 4.8 **$5·$25**, Fable 5 **$10·$50**, Sonnet 4.6 **$3·$15**,
Haiku 4.5 **$1·$5**.

## Knob rules (each wrong pairing is a guaranteed 400)

These are enforced by `validateKnobs` at provision time, so a misconfigured spec fails
the dry-run instead of erroring against the live API:

- **`xhigh` is Opus-4.7+/Fable-only.** Never on **Sonnet 4.6** (caps at `max` — there is
  no `xhigh` rung) or on **Haiku 4.5**.
- **The `effort` param errors on Haiku 4.5** (and Sonnet 4.5). **Workers omit `effort`
  entirely** — the spec simply has no `effort` key on the Haiku agent.
- **Adaptive thinking is Opus 4.6+/Sonnet 4.6/Fable-only — not Haiku.** The Haiku worker
  has no `thinking` key.
- **Opus 4.8 & Fable 5:** no `budget_tokens`, no `temperature`/`top_p`/`top_k` — control
  depth with `output_config.effort` only.
- **Fable 5:** never `thinking:{type:"disabled"}` (400) — **omit** the param (thinking is
  always-on). The Fable agent therefore has **no `thinking` key**. It additionally
  requires the server-side refusal-safe path so a `stop_reason:"refusal"` doesn't kill a
  tick:
  - `betas: ["server-side-fallback-2026-06-01"]` — the header is **exact**; it carries the
    earliest date of the series, so don't "correct" it to a newer-looking date.
  - `fallbacks: [{ model: "claude-opus-4-8" }]` — a declined request is transparently
    re-served by the fallback model in the same call.
  - **30-day data retention** — Fable 5 is not available under zero data retention (every
    request 400s otherwise). The spec carries `data_retention_days: 30`.

`provision.ts` cross-checks all of the above: knob pairings via `validateKnobs`, and the
Fable refusal-safe wiring (betas + fallback to Opus + 30-day retention) as spec-level
invariants.
