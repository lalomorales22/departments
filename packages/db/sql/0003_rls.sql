-- ════════════════════════════════════════════════════════════════════════════
-- 0003_rls.sql — Row-Level Security (multi-tenant isolation).
--
-- Tenant isolation is enforced at the row, not in application code. Every tenant
-- table carries org_id NOT NULL; a policy on each restricts every command
-- (SELECT/INSERT/UPDATE/DELETE) to rows whose org_id equals the current request's
-- org.
--
-- HOW THE ORG IS SET PER REQUEST:
--   The NestJS gateway authenticates the caller, resolves their org, and — at the
--   start of each request's transaction — runs:
--       SELECT set_config('app.current_org', '<org-uuid>', true);   -- tx-local
--   (or `SET LOCAL app.current_org = '<org-uuid>'`). Every policy reads that GUC
--   via current_setting('app.current_org', true) and casts it to uuid. The second
--   arg `true` makes current_setting() return NULL (instead of erroring) when the
--   GUC is unset, so an unscoped connection simply sees zero rows rather than
--   leaking or crashing.
--
-- FORCE ROW LEVEL SECURITY is applied so the policies also constrain the table
-- OWNER (the migration/app role), not just non-owner roles. The connection used
-- by the gateway must therefore NOT be a superuser and must not have BYPASSRLS.
--
-- A dedicated, privileged migration/seed path that needs to cross orgs should use
-- a role with BYPASSRLS (e.g. for the 0100_seed.sql load) — never the request
-- connection.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- org — the tenant root. A scoped session may only see/modify its own org row
-- (id = current org). org has no org_id column, so the predicate is on id.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE org ENABLE ROW LEVEL SECURITY;
ALTER TABLE org FORCE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON org
  USING (id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (id = current_setting('app.current_org', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant tables — identical org_id-scoped policy on each. USING governs which
-- existing rows are visible/affected (SELECT/UPDATE/DELETE); WITH CHECK governs
-- which rows may be written (INSERT/UPDATE). Both pinned to the current org so a
-- session can neither read nor write another tenant's rows, and cannot move a row
-- to another org.
-- ─────────────────────────────────────────────────────────────────────────────

-- app_user
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
CREATE POLICY app_user_isolation ON app_user
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- loop
ALTER TABLE loop ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop FORCE ROW LEVEL SECURITY;
CREATE POLICY loop_isolation ON loop
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- agent
ALTER TABLE agent ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_isolation ON agent
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- subagent
ALTER TABLE subagent ENABLE ROW LEVEL SECURITY;
ALTER TABLE subagent FORCE ROW LEVEL SECURITY;
CREATE POLICY subagent_isolation ON subagent
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- task
ALTER TABLE task ENABLE ROW LEVEL SECURITY;
ALTER TABLE task FORCE ROW LEVEL SECURITY;
CREATE POLICY task_isolation ON task
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- run
ALTER TABLE run ENABLE ROW LEVEL SECURITY;
ALTER TABLE run FORCE ROW LEVEL SECURITY;
CREATE POLICY run_isolation ON run
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- event
ALTER TABLE event ENABLE ROW LEVEL SECURITY;
ALTER TABLE event FORCE ROW LEVEL SECURITY;
CREATE POLICY event_isolation ON event
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- metric
ALTER TABLE metric ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric FORCE ROW LEVEL SECURITY;
CREATE POLICY metric_isolation ON metric
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- memory
ALTER TABLE memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_isolation ON memory
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- artifact
ALTER TABLE artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact FORCE ROW LEVEL SECURITY;
CREATE POLICY artifact_isolation ON artifact
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- artifact_version
ALTER TABLE artifact_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_version FORCE ROW LEVEL SECURITY;
CREATE POLICY artifact_version_isolation ON artifact_version
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- outcome
ALTER TABLE outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome FORCE ROW LEVEL SECURITY;
CREATE POLICY outcome_isolation ON outcome
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- rubric
ALTER TABLE rubric ENABLE ROW LEVEL SECURITY;
ALTER TABLE rubric FORCE ROW LEVEL SECURITY;
CREATE POLICY rubric_isolation ON rubric
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- vault
ALTER TABLE vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault FORCE ROW LEVEL SECURITY;
CREATE POLICY vault_isolation ON vault
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);
