-- ════════════════════════════════════════════════════════════════════════════
-- 0001_init.sql — Departments core schema.
--
-- The relational core mirrors packages/shared/src/types.ts and the README "Data
-- model" section. Every tenant-scoped row carries org_id NOT NULL REFERENCES
-- org(id); cross-org isolation is enforced at the row by RLS in 0003_rls.sql.
--
-- ⚠️ CANONICAL VOCABULARY — DO NOT LET THIS DRIFT:
--   The engine's 4th lifecycle phase is named 'improve'. The UI pipeline labels
--   that SAME stage 'OPTIMIZE'. They are the same thing. run.phase / loop.phase
--   persist 'improve'; the dashboard renders 'OPTIMIZE'. The label↔phase↔color
--   mapping lives in exactly one place (packages/shared/src/pipeline.ts) — never
--   hardcode it. The phase enum below intentionally includes both 'bootstrap'
--   (the resumable cold-start) and 'improve' (NOT 'optimize').
--
-- Primary keys are uuid DEFAULT gen_random_uuid() (requires the pgcrypto-provided
-- gen_random_uuid(), available in core PG13+). Timestamps are timestamptz.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums — values match packages/shared/src/enums.ts EXACTLY.
-- ─────────────────────────────────────────────────────────────────────────────

-- USER_ROLES: commander holds the kill switch.
CREATE TYPE user_role AS ENUM ('owner', 'commander', 'operator', 'viewer');

-- LOOP_LEVELS (1..4) — stored as smallint with a CHECK below, not an enum, since
-- it is numeric. loop_status drives the tree status dot.
CREATE TYPE loop_status AS ENUM ('running', 'idle', 'paused', 'stopped', 'error');

-- AGENT_ROLES — coordinator is the meta/CEO role.
CREATE TYPE agent_role AS ENUM ('planner', 'executor', 'qa', 'docs', 'reviewer', 'coordinator');

-- AGENT_STATUSES — shared by agent and subagent.
CREATE TYPE agent_status AS ENUM ('running', 'idle', 'blocked', 'error');

-- TASK_STATES — Kanban columns.
CREATE TYPE task_state AS ENUM ('todo', 'in_progress', 'review', 'done');

-- TASK_PRIORITIES.
CREATE TYPE task_priority AS ENUM ('P1', 'P2', 'P3');

-- TASK_AREAS — mirrors the L3 execution departments.
CREATE TYPE task_area AS ENUM (
  'research', 'content', 'seo', 'analytics', 'campaign', 'design', 'engineering', 'ops'
);

-- PHASES — includes 'bootstrap' (resumable cold-start) AND 'improve' (UI 'OPTIMIZE').
CREATE TYPE phase AS ENUM ('bootstrap', 'plan', 'execute', 'evaluate', 'improve', 'memory');

-- EVENT_KINDS — the frozen terminal/realtime feed.
CREATE TYPE event_kind AS ENUM (
  'log', 'debug', 'output', 'agent_msg', 'tool_use', 'status', 'metric', 'error'
);

-- RUBRIC_CATEGORIES — the four gates scored by the independent grader.
CREATE TYPE rubric_category AS ENUM ('quality', 'data_validation', 'alignment_risk', 'performance');

-- OUTCOME_RESULTS — mapped from CMA span.outcome_evaluation_*.
CREATE TYPE outcome_result AS ENUM ('satisfied', 'needs_revision', 'max_iterations_reached', 'failed');

-- ARTIFACT_KINDS — files-as-memory.
CREATE TYPE artifact_kind AS ENUM (
  'readme', 'tasks', 'handoff', 'report', 'strategy', 'source', 'dashboard'
);

-- GOOD_DIRECTIONS — which way is "good" for a metric (Bounce Rate / CAC = down).
CREATE TYPE good_direction AS ENUM ('up', 'down');

-- ─────────────────────────────────────────────────────────────────────────────
-- Org / identity
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE org (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  name        text NOT NULL,
  email       text NOT NULL,
  role        user_role NOT NULL DEFAULT 'viewer',
  avatar_url  text,
  initials    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);
CREATE INDEX app_user_org_idx ON app_user (org_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Loop — the self-referential department tree.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE loop (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  parent_loop_id  uuid REFERENCES loop(id) ON DELETE SET NULL,
  name            text NOT NULL,            -- one-word `loop <name>` handle
  display_name    text NOT NULL,
  level           smallint NOT NULL CHECK (level BETWEEN 1 AND 4),
  mission         text NOT NULL,
  status          loop_status NOT NULL DEFAULT 'idle',
  health          smallint NOT NULL DEFAULT 100 CHECK (health BETWEEN 0 AND 100),
  phase           phase,                    -- null when never run / stopped
  cycle_count     integer NOT NULL DEFAULT 0 CHECK (cycle_count >= 0),
  cadence         text NOT NULL DEFAULT 'manual',
  cma_agent_id    text,                     -- CMA primitives (null until provisioned)
  memory_store_id text,
  repo_url        text,
  budget_cap_usd  numeric(12, 2) NOT NULL DEFAULT 0 CHECK (budget_cap_usd >= 0),
  spent_usd       numeric(12, 2) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX loop_org_idx ON loop (org_id);
CREATE INDEX loop_parent_idx ON loop (parent_loop_id);
CREATE INDEX loop_org_status_idx ON loop (org_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Agent / Subagent
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE agent (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  loop_id     uuid NOT NULL REFERENCES loop(id) ON DELETE CASCADE,
  role        agent_role NOT NULL,
  name        text NOT NULL,
  model_id    text NOT NULL,
  -- effort knob; NULL for Haiku workers (the param errors there).
  effort      text,
  status      agent_status NOT NULL DEFAULT 'idle',
  activity    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_org_idx ON agent (org_id);
CREATE INDEX agent_loop_idx ON agent (loop_id);

-- Subagents are tenant-scoped too (transient fan-out workers).
CREATE TABLE subagent (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  cma_thread_id text,
  status        agent_status NOT NULL DEFAULT 'idle',
  label         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subagent_org_idx ON subagent (org_id);
CREATE INDEX subagent_agent_idx ON subagent (agent_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Task — the Kanban board.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE task (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  loop_id     uuid NOT NULL REFERENCES loop(id) ON DELETE CASCADE,
  title       text NOT NULL,
  area        task_area NOT NULL,
  priority    task_priority NOT NULL DEFAULT 'P2',
  state       task_state NOT NULL DEFAULT 'todo',
  assignee_id uuid REFERENCES agent(id) ON DELETE SET NULL,
  tags        text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_org_idx ON task (org_id);
CREATE INDEX task_loop_state_idx ON task (loop_id, state);
CREATE INDEX task_assignee_idx ON task (assignee_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Run — the audit spine. One row per engine tick / phase.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE run (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  loop_id        uuid NOT NULL REFERENCES loop(id) ON DELETE CASCADE,
  phase          phase NOT NULL,
  tick_no        integer NOT NULL CHECK (tick_no >= 0),
  cma_session_id text,
  -- token usage snapshot: { inputTokens, outputTokens, cacheReadInputTokens,
  -- cacheCreationInputTokens }
  usage          jsonb,
  cost_usd       numeric(12, 4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz
);
CREATE INDEX run_org_idx ON run (org_id);
CREATE INDEX run_loop_idx ON run (loop_id);
CREATE INDEX run_loop_tick_idx ON run (loop_id, tick_no);

-- ─────────────────────────────────────────────────────────────────────────────
-- Event — the per-loop append-only terminal feed (replay-from-offset).
-- seq is a per-loop monotonic offset; UNIQUE(loop_id, seq) is the dedupe key the
-- realtime layer (Redis Streams → WS) resumes from.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE event (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- stable, content-independent id
  org_id    uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  loop_id   uuid NOT NULL REFERENCES loop(id) ON DELETE CASCADE,
  run_id    uuid REFERENCES run(id) ON DELETE SET NULL,
  seq       bigint NOT NULL,
  kind      event_kind NOT NULL,
  payload   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loop_id, seq)
);
CREATE INDEX event_org_idx ON event (org_id);
CREATE INDEX event_loop_seq_idx ON event (loop_id, seq);
CREATE INDEX event_run_idx ON event (run_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Metric — live metric cards.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE metric (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  loop_id        uuid NOT NULL REFERENCES loop(id) ON DELETE CASCADE,
  key            text NOT NULL,             -- stable key, e.g. "bounce_rate"
  name           text NOT NULL,             -- display, e.g. "Bounce Rate"
  value          double precision NOT NULL,
  display        text NOT NULL,             -- formatted, e.g. "42.3%"
  delta          double precision NOT NULL DEFAULT 0,
  good_direction good_direction NOT NULL,
  series         double precision[] NOT NULL DEFAULT '{}',
  unit           text,
  ts             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX metric_org_idx ON metric (org_id);
CREATE INDEX metric_loop_ts_idx ON metric (loop_id, ts);

-- ─────────────────────────────────────────────────────────────────────────────
-- Memory — the context panel (pgvector). The embedding column is added in
-- 0002_pgvector.sql so this migration is runnable without the extension present.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE memory (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  loop_id      uuid NOT NULL REFERENCES loop(id) ON DELETE CASCADE,
  path         text NOT NULL,               -- e.g. "HANDOFF.md#decisions"
  summary      text NOT NULL,
  content_ref  text,                        -- S3 / git SHA of full content blob
  -- embedding vector(1536) — added in 0002_pgvector.sql
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_org_idx ON memory (org_id);
CREATE INDEX memory_loop_idx ON memory (loop_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Artifact / ArtifactVersion — files-as-memory + version history.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE artifact (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  loop_id     uuid NOT NULL REFERENCES loop(id) ON DELETE CASCADE,
  kind        artifact_kind NOT NULL,
  path        text NOT NULL,
  version     text NOT NULL,                -- latest version label, e.g. "v12"
  size_bytes  bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loop_id, path)
);
CREATE INDEX artifact_org_idx ON artifact (org_id);
CREATE INDEX artifact_loop_idx ON artifact (loop_id);

CREATE TABLE artifact_version (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  artifact_id  uuid NOT NULL REFERENCES artifact(id) ON DELETE CASCADE,
  version      text NOT NULL,
  git_sha      text NOT NULL,
  blob_ref     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version)
);
CREATE INDEX artifact_version_org_idx ON artifact_version (org_id);
CREATE INDEX artifact_version_artifact_idx ON artifact_version (artifact_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Outcome / Rubric — EVALUATE + IMPROVE checks & balances.
-- A run produces 0..1 outcome; an outcome aggregates rubric category scores.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE outcome (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  run_id         uuid NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  result         outcome_result NOT NULL,
  iterations     integer NOT NULL DEFAULT 0 CHECK (iterations >= 0),
  max_iterations integer NOT NULL DEFAULT 1 CHECK (max_iterations >= 1),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id)
);
CREATE INDEX outcome_org_idx ON outcome (org_id);
CREATE INDEX outcome_run_idx ON outcome (run_id);

CREATE TABLE rubric (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  outcome_id  uuid NOT NULL REFERENCES outcome(id) ON DELETE CASCADE,
  category    rubric_category NOT NULL,
  passed      boolean NOT NULL DEFAULT false,
  score       smallint NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  notes       text,
  UNIQUE (outcome_id, category)
);
CREATE INDEX rubric_org_idx ON rubric (org_id);
CREATE INDEX rubric_outcome_idx ON rubric (outcome_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Vault — CMA credential vaults (egress injection), one set per org.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE vault (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  cma_vault_id text NOT NULL,
  label        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vault_org_idx ON vault (org_id);
