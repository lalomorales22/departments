-- ════════════════════════════════════════════════════════════════════════════
-- 0006_audit.sql — Phase 5 (Production Hardening): append-only tamper-evidence,
-- an audit log for the control plane, and RLS-/cost-audit read surfaces.
--
-- Four concerns, all multi-tenant-safe:
--   1. IMMUTABILITY  — the append-only spines (event, run, artifact_version) reject
--      UPDATE and DELETE from the request role, so history cannot be silently
--      rewritten. A privileged retention/purge job sets `app.allow_purge = 'on'`
--      to perform controlled lifecycle deletes (and to let ON DELETE CASCADE from
--      an admin-initiated loop/org removal proceed). The per-request gateway
--      connection never sets it, so it can neither mutate nor delete a spine row.
--   2. AUDIT LOG     — every change to a CONTROL-PLANE table (roles, caps, cadence,
--      tasks, vaults, gate outcomes, …) is recorded in audit_log with old/new
--      jsonb + the acting user. The event/metric firehose is excluded (its
--      tamper-evidence is the app-level hash chain in @departments/events).
--   3. RLS AUDIT     — rls_violation_audit surfaces any cross-org FK mismatch
--      (a child row whose org_id != its parent's). Belt-and-suspenders over the
--      0003 policies; consumed by the CI RLS gate (test/rls.policy.test.md §G).
--   4. COST AUDIT    — caching_audit (per-run cache-hit ratio) + gate_pass_daily
--      (the four-gate pass rate over time) for the ANALYTICS tab + cost runbook.
--
-- ⚠️ The frozen Event protocol (EVENT_PROTOCOL_VERSION = 1) is NOT touched: no new
--   event columns, no kind changes. Tamper-evidence is the hash chain (sidecar) +
--   these triggers/views, never a wire-shape change.
-- ⚠️ security_invoker views require PostgreSQL 15+ (same constraint as 0005).
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Immutability — the append-only spines reject mutation by the request role.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION dept_immutable_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A privileged purge/retention job (or an admin-initiated cascade) opts in.
  IF current_setting('app.allow_purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'immutable: % rows are append-only (% blocked); set app.allow_purge to purge',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS event_immutable ON event;
CREATE TRIGGER event_immutable
  BEFORE UPDATE OR DELETE ON event
  FOR EACH ROW EXECUTE FUNCTION dept_immutable_check();

DROP TRIGGER IF EXISTS run_immutable ON run;
CREATE TRIGGER run_immutable
  BEFORE UPDATE OR DELETE ON run
  FOR EACH ROW EXECUTE FUNCTION dept_immutable_check();

DROP TRIGGER IF EXISTS artifact_version_immutable ON artifact_version;
CREATE TRIGGER artifact_version_immutable
  BEFORE UPDATE OR DELETE ON artifact_version
  FOR EACH ROW EXECUTE FUNCTION dept_immutable_check();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Audit log — old/new snapshots of control-plane changes, with the acting user.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  table_name  text NOT NULL,
  operation   text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id   uuid,
  -- The acting user, read from the per-request GUC the gateway sets (may be NULL
  -- for system/engine writes). Not a hard FK so a later user deletion can't orphan
  -- the immutable audit trail.
  changed_by  uuid,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  old_values  jsonb,
  new_values  jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_org_idx ON audit_log (org_id);
CREATE INDEX IF NOT EXISTS audit_log_record_idx ON audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS audit_log_changed_at_idx ON audit_log (changed_at);

-- audit_log is itself append-only (it records tampering; it must not be tamperable).
DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION dept_immutable_check();

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_isolation ON audit_log
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

CREATE OR REPLACE FUNCTION dept_audit_log() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor uuid;
BEGIN
  -- The gateway sets app.current_user per request; tolerate unset/empty (system).
  BEGIN
    actor := nullif(current_setting('app.current_user', true), '')::uuid;
  EXCEPTION WHEN others THEN
    actor := NULL;
  END;
  INSERT INTO audit_log (org_id, table_name, operation, record_id, changed_by, old_values, new_values)
  VALUES (
    COALESCE(NEW.org_id, OLD.org_id),
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(NEW.id, OLD.id),
    actor,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach to the CONTROL-PLANE tables (security-sensitive state). The high-volume
-- event/metric firehose + the immutable run/artifact_version spines are excluded —
-- their integrity is covered by the hash chain + the immutability triggers above.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_user', 'loop', 'agent', 'subagent', 'task', 'memory', 'artifact', 'outcome', 'rubric', 'vault'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_audit ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dept_audit_log()',
      t, t
    );
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Audit checkpoints — bracket every deploy with a verified RLS/immutability mark.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_snapshot (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  checkpoint_name     text NOT NULL,
  verified_at         timestamptz NOT NULL DEFAULT now(),
  rls_enforcement_ok  boolean NOT NULL DEFAULT false,
  mutation_count      bigint NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, checkpoint_name)
);
ALTER TABLE audit_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_snapshot_isolation ON audit_snapshot
  USING (org_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org', true)::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS-violation audit — any child row whose org_id != its parent's org_id.
--    With 0003's WITH CHECK policies this set should ALWAYS be empty; a non-empty
--    result is a cross-tenant integrity breach. security_invoker so a scoped
--    session only ever sees its own org's rows (RLS applies transitively).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW rls_violation_audit
  WITH (security_invoker = true) AS
  SELECT a.org_id, 'agent_vs_loop'      AS violation_type, a.id AS record_id, 'agent'            AS table_name, l.org_id AS parent_org_id FROM agent a            JOIN loop l    ON a.loop_id = l.id     WHERE a.org_id <> l.org_id
  UNION ALL
  SELECT t.org_id, 'task_vs_loop',       t.id, 'task',             l.org_id FROM task t            JOIN loop l    ON t.loop_id = l.id     WHERE t.org_id <> l.org_id
  UNION ALL
  SELECT r.org_id, 'run_vs_loop',        r.id, 'run',              l.org_id FROM run r             JOIN loop l    ON r.loop_id = l.id     WHERE r.org_id <> l.org_id
  UNION ALL
  SELECT e.org_id, 'event_vs_loop',      e.id, 'event',            l.org_id FROM event e           JOIN loop l    ON e.loop_id = l.id     WHERE e.org_id <> l.org_id
  UNION ALL
  SELECT m.org_id, 'metric_vs_loop',     m.id, 'metric',           l.org_id FROM metric m          JOIN loop l    ON m.loop_id = l.id     WHERE m.org_id <> l.org_id
  UNION ALL
  SELECT mm.org_id, 'memory_vs_loop',    mm.id, 'memory',          l.org_id FROM memory mm         JOIN loop l    ON mm.loop_id = l.id    WHERE mm.org_id <> l.org_id
  UNION ALL
  SELECT ar.org_id, 'artifact_vs_loop',  ar.id, 'artifact',        l.org_id FROM artifact ar       JOIN loop l    ON ar.loop_id = l.id    WHERE ar.org_id <> l.org_id
  UNION ALL
  SELECT o.org_id, 'outcome_vs_run',     o.id, 'outcome',          r.org_id FROM outcome o         JOIN run r     ON o.run_id = r.id      WHERE o.org_id <> r.org_id
  UNION ALL
  SELECT rb.org_id, 'rubric_vs_outcome', rb.id, 'rubric',          o.org_id FROM rubric rb         JOIN outcome o ON rb.outcome_id = o.id WHERE rb.org_id <> o.org_id
  UNION ALL
  SELECT c.org_id, 'loop_vs_parent',     c.id, 'loop',             p.org_id FROM loop c            JOIN loop p    ON c.parent_loop_id = p.id WHERE c.org_id <> p.org_id;

COMMENT ON VIEW rls_violation_audit IS
  'Phase 5 cross-tenant integrity audit: rows whose org_id differs from their '
  'parent''s. Should ALWAYS be empty under the 0003 RLS WITH CHECK policies; the '
  'CI RLS gate (test/rls.policy.test.md §G) asserts count = 0.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Caching audit — per-run prompt-cache hit ratio (the #1 cost lever).
--    Alert when cache_hit_ratio ≈ 0 (cold/degraded) on a run that spent money.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW caching_audit
  WITH (security_invoker = true) AS
SELECT
  r.org_id,
  r.loop_id,
  r.id AS run_id,
  r.phase,
  COALESCE((r.usage ->> 'cacheReadInputTokens')::bigint, 0)      AS cache_read,
  COALESCE((r.usage ->> 'cacheCreationInputTokens')::bigint, 0)  AS cache_write,
  COALESCE((r.usage ->> 'inputTokens')::bigint, 0)               AS uncached_input,
  -- read / (read + write + uncached input) — 0 when there is no input at all.
  CASE
    WHEN COALESCE((r.usage ->> 'cacheReadInputTokens')::bigint, 0)
       + COALESCE((r.usage ->> 'cacheCreationInputTokens')::bigint, 0)
       + COALESCE((r.usage ->> 'inputTokens')::bigint, 0) = 0 THEN 0
    ELSE COALESCE((r.usage ->> 'cacheReadInputTokens')::numeric, 0)
       / (COALESCE((r.usage ->> 'cacheReadInputTokens')::numeric, 0)
        + COALESCE((r.usage ->> 'cacheCreationInputTokens')::numeric, 0)
        + COALESCE((r.usage ->> 'inputTokens')::numeric, 0))
  END AS cache_hit_ratio,
  r.cost_usd,
  r.started_at
FROM run r
WHERE r.cost_usd > 0;

COMMENT ON VIEW caching_audit IS
  'Phase 5 cost audit: per-run prompt-cache hit ratio. Alert when cache_hit_ratio '
  'is ~0 across a loop''s ticks (a prefix invalidator silently disabled the #1 lever).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Gate-pass over time — Health % = rolling four-gate pass rate, per loop/day.
--    From rubric (per-category passed) ← outcome ← run (loop + day). A view (not a
--    matview) so RLS applies via security_invoker.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW gate_pass_daily
  WITH (security_invoker = true) AS
SELECT
  r.org_id,
  r.loop_id,
  date_trunc('day', r.started_at)::date                                   AS day,
  count(*) FILTER (WHERE rb.passed)::numeric / NULLIF(count(*), 0)        AS gate_pass_rate,
  round(100 * count(*) FILTER (WHERE rb.passed)::numeric / NULLIF(count(*), 0)) AS health_pct,
  count(*) FILTER (WHERE rb.category = 'quality'        AND rb.passed)::numeric / NULLIF(count(*) FILTER (WHERE rb.category = 'quality'), 0)        AS quality_rate,
  count(*) FILTER (WHERE rb.category = 'data_validation' AND rb.passed)::numeric / NULLIF(count(*) FILTER (WHERE rb.category = 'data_validation'), 0) AS data_validation_rate,
  count(*) FILTER (WHERE rb.category = 'alignment_risk'  AND rb.passed)::numeric / NULLIF(count(*) FILTER (WHERE rb.category = 'alignment_risk'), 0)  AS alignment_risk_rate,
  count(*) FILTER (WHERE rb.category = 'performance'     AND rb.passed)::numeric / NULLIF(count(*) FILTER (WHERE rb.category = 'performance'), 0)     AS performance_rate
FROM rubric rb
JOIN outcome o ON rb.outcome_id = o.id
JOIN run r ON o.run_id = r.id
GROUP BY r.org_id, r.loop_id, date_trunc('day', r.started_at);

COMMENT ON VIEW gate_pass_daily IS
  'Phase 5: Health % = rolling four-gate pass rate, per (org_id, loop_id, day), '
  'with the per-category breakdown. Drives the ANALYTICS health-over-time series.';
