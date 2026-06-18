-- ════════════════════════════════════════════════════════════════════════════
-- 0005_rollup.sql — Phase 4 (Hierarchy & Meta-Loop): cross-loop rollups + trees.
--
-- The CEO meta-loop governs a tree of child loops (loop.parent_loop_id is the
-- self-edge; loop.level is 1..4). This migration adds the read-side objects that
-- power two surfaces:
--   • the HIERARCHY panel  — needs each loop's root, depth, and ancestor path so
--     it can draw the tree and roll a subtree up under any node;
--   • the ANALYTICS tab    — needs per-subtree aggregates (rolled health / spend /
--     budget / worst status) and an aggregate-health-over-time series.
--
-- Three objects:
--   1. VIEW  loop_tree        — per loop: root id, depth, ancestor path[].
--   2. VIEW  loop_rollup      — per loop: subtree aggregates (self + descendants).
--   3. MATVIEW org_health_daily — per (org_id, day): avg of metric.value where
--                                  key='health', for the ANALYTICS time series.
--
-- ⚠️ CANONICAL VOCABULARY — DO NOT LET THIS DRIFT:
--   loop_status values are exactly running / idle / paused / stopped / error
--   (see 0001_init.sql). The engine's 4th lifecycle phase is 'improve' (the UI
--   renders that SAME stage as 'OPTIMIZE'); there is no 'optimize' value anywhere
--   in the database. Nothing here introduces new vocabulary.
--
-- ⚠️ TENANT ISOLATION ACROSS A VIEW — READ THIS:
--   A regular Postgres view executes with the rights of its DEFINER (the role that
--   created it — here the migration/app owner). That means a view BY DEFAULT
--   bypasses the base-table RLS of the *querying* role: a scoped session reading
--   loop_tree would otherwise see EVERY org's loops, because the view body's
--   access to `loop` runs as the owner, not as the caller. To keep multi-tenant
--   isolation (0003_rls.sql) intact, loop_tree and loop_rollup are created
--   WITH (security_invoker = true) (PostgreSQL 15+). With security_invoker on, the
--   view body is evaluated under the *caller's* permissions and RLS, so the
--   loop_isolation / metric_isolation policies apply transitively and a session
--   only ever sees rows for org_id = current_setting('app.current_org', true)::uuid.
--   Each view ALSO carries org_id so callers can (and the matview must) filter
--   explicitly, and so the column is available to the app/ORM.
--
--   REQUIREMENT: security_invoker requires PostgreSQL >= 15. The project targets
--   PG15+ (gen_random_uuid from core PG13+ is already assumed in 0001). On PG<15
--   this option is unknown and CREATE VIEW would error — do not back-port below 15.
--
-- Idempotent like the rest of sql/: CREATE OR REPLACE VIEW for the views, and
-- DROP MATERIALIZED VIEW IF EXISTS + CREATE for the matview (its column set may
-- change between revisions, which CREATE OR REPLACE cannot do), plus
-- CREATE INDEX IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS.
--
-- Order: runs after RLS (0003) and the metric unique key (0004). The matview's
-- initial population (WITH DATA) reads `metric`; see the refresh note below for
-- how it is kept current and why its read path needs an explicit org filter.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. loop_tree — hierarchy materialization for the HIERARCHY panel.
--
-- A recursive CTE walks down from each root (parent_loop_id IS NULL) accumulating
-- depth and the ancestor path. Per loop it exposes:
--   id, org_id, parent_loop_id, root_loop_id, depth (root = 0), level (1..4),
--   path (uuid[] of ancestor ids from root → this loop, inclusive).
--
-- org_id is selected so RLS applies and so the panel can filter/group by tenant.
-- security_invoker (above) means the recursion only ever traverses the caller's
-- own org's loops; a row whose parent is in another org is impossible because the
-- caller cannot see cross-org loops at all, so subtrees never bleed across tenants.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW loop_tree
  WITH (security_invoker = true) AS
WITH RECURSIVE tree AS (
  -- Roots: loops with no parent. depth 0; path is just the loop itself.
  SELECT
    l.id,
    l.org_id,
    l.parent_loop_id,
    l.id                       AS root_loop_id,
    0                          AS depth,
    l.level,
    ARRAY[l.id]                AS path
  FROM loop l
  WHERE l.parent_loop_id IS NULL

  UNION ALL

  -- Descend one edge at a time, carrying root + extending the path.
  SELECT
    c.id,
    c.org_id,
    c.parent_loop_id,
    t.root_loop_id,
    t.depth + 1                AS depth,
    c.level,
    t.path || c.id             AS path
  FROM loop c
  JOIN tree t ON c.parent_loop_id = t.id
)
SELECT
  id,
  org_id,
  parent_loop_id,
  root_loop_id,
  depth,
  level,
  path
FROM tree;

COMMENT ON VIEW loop_tree IS
  'Phase 4 hierarchy materialization (security_invoker): per loop exposes '
  'root_loop_id, depth (root=0), level, and the inclusive ancestor path uuid[]. '
  'Runs under the caller''s RLS so it is tenant-scoped.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. loop_rollup — per-loop subtree aggregates for the ANALYTICS / hierarchy roll-up.
--
-- For every loop, aggregate ITSELF + ALL DESCENDANTS:
--   rolled_health     — avg(health) across the subtree (numeric).
--   rolled_spent_usd  — sum(spent_usd) across the subtree.
--   rolled_budget_usd — sum(budget_cap_usd) across the subtree.
--   descendant_count  — number of STRICT descendants (subtree size minus self).
--   worst_status      — the most attention-needing status in the subtree, ranked
--                       error > paused > running > idle > stopped via a CASE
--                       severity score (higher = needs more attention):
--                         error=5, paused=4, running=3, idle=2, stopped=1.
--                       We take max(severity) over the subtree and map it back to
--                       the loop_status label.
--
-- Implementation: the recursive CTE pairs each ANCESTOR loop with every loop in
-- its subtree (anc = the loop we are rolling up TO; node = a member of its
-- subtree, starting with itself). Aggregating per anc.id then yields the rollup.
-- org_id is carried for RLS + grouping; security_invoker scopes traversal to the
-- caller's org exactly as in loop_tree.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW loop_rollup
  WITH (security_invoker = true) AS
WITH RECURSIVE subtree AS (
  -- Seed: every loop is the root of its own subtree (includes itself).
  SELECT
    l.id      AS anc_id,
    l.org_id  AS anc_org_id,
    l.id      AS node_id
  FROM loop l

  UNION ALL

  -- Attach each child loop to all of the ancestors its parent belongs to.
  SELECT
    s.anc_id,
    s.anc_org_id,
    c.id      AS node_id
  FROM loop c
  JOIN subtree s ON c.parent_loop_id = s.node_id
)
SELECT
  s.anc_id                                            AS loop_id,
  s.anc_org_id                                         AS org_id,
  avg(n.health)::numeric                               AS rolled_health,
  sum(n.spent_usd)                                     AS rolled_spent_usd,
  sum(n.budget_cap_usd)                                AS rolled_budget_usd,
  -- strict descendants = every node in the subtree except the loop itself
  count(*) FILTER (WHERE n.id <> s.anc_id)             AS descendant_count,
  -- map the max severity back to the canonical loop_status label
  CASE max(
    CASE n.status
      WHEN 'error'   THEN 5
      WHEN 'paused'  THEN 4
      WHEN 'running' THEN 3
      WHEN 'idle'    THEN 2
      WHEN 'stopped' THEN 1
    END
  )
    WHEN 5 THEN 'error'
    WHEN 4 THEN 'paused'
    WHEN 3 THEN 'running'
    WHEN 2 THEN 'idle'
    WHEN 1 THEN 'stopped'
  END::loop_status                                      AS worst_status
FROM subtree s
JOIN loop n ON n.id = s.node_id
GROUP BY s.anc_id, s.anc_org_id;

COMMENT ON VIEW loop_rollup IS
  'Phase 4 subtree rollup (security_invoker): per loop, avg health / summed spend '
  '& budget / strict descendant_count / worst_status (severity '
  'error>paused>running>idle>stopped) over itself + all descendants. Tenant-scoped.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. org_health_daily — ANALYTICS "aggregate health over time".
--
-- Per (org_id, day) the average of metric.value where key='health', bucketed by
-- date_trunc('day', ts). A MATERIALIZED VIEW (not a regular view) because the
-- ANALYTICS time series is read on every tab load and recomputing the daily
-- average over the full metric history each time is wasteful.
--
-- ⚠️ RLS CAVEAT — a matview CANNOT be security_invoker:
--   A materialized view stores rows produced once, by the role that runs REFRESH;
--   the security_invoker option does not exist for matviews, and a plain matview
--   is NOT covered by the base-table RLS of a later reader. Therefore:
--     • REFRESH must be run by a PRIVILEGED job (a role allowed to read all orgs'
--       metric rows — e.g. the BYPASSRLS loader/maintenance role described in
--       0003_rls.sql), NOT the per-request gateway connection. The matview holds
--       EVERY org's daily health, by design, so analytics can be precomputed once.
--     • The ANALYTICS read path is therefore responsible for tenant scoping at the
--       APP LEVEL and MUST always filter:
--           WHERE org_id = current_setting('app.current_org', true)::uuid
--       (Postgres does not allow ENABLE ROW LEVEL SECURITY on a MATERIALIZED VIEW,
--       so RLS cannot back-stop this the way it does for the base tables; the org
--       filter on the read query is the only isolation for this object — it is a
--       hard requirement, asserted in test/rls.policy.test.md.)
--
-- REFRESH CADENCE: refreshed by a scheduled privileged job — nightly is the
-- baseline; trigger an extra refresh after large metric backfills. The unique
-- index below on (org_id, day) makes REFRESH MATERIALIZED VIEW CONCURRENTLY
-- possible, so the ANALYTICS reads never block on a refresh.
--
-- Idempotent via DROP IF EXISTS + CREATE (the column set / definition may evolve;
-- CREATE OR REPLACE cannot change a matview's columns).
-- ─────────────────────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS org_health_daily;

CREATE MATERIALIZED VIEW org_health_daily AS
SELECT
  m.org_id                            AS org_id,
  date_trunc('day', m.ts)             AS day,
  avg(m.value)                        AS avg_health,
  count(*)                            AS sample_count
FROM metric m
WHERE m.key = 'health'
GROUP BY m.org_id, date_trunc('day', m.ts)
WITH DATA;

-- Unique index on (org_id, day) — REQUIRED for REFRESH ... CONCURRENTLY and the
-- natural read/lookup key. Idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS org_health_daily_org_day_uidx
  ON org_health_daily (org_id, day);

-- Secondary index for the common "this org's series over time" scan.
CREATE INDEX IF NOT EXISTS org_health_daily_org_idx
  ON org_health_daily (org_id);

COMMENT ON MATERIALIZED VIEW org_health_daily IS
  'Phase 4 ANALYTICS aggregate health over time: per (org_id, day) avg of '
  'metric.value where key=''health''. NOT RLS-protected (matviews cannot be '
  'security_invoker / cannot ENABLE RLS) — refresh via a PRIVILEGED job '
  '(nightly baseline; CONCURRENTLY, enabled by the unique (org_id,day) index) '
  'and the ANALYTICS read path MUST filter org_id = '
  'current_setting(''app.current_org'', true)::uuid.';
