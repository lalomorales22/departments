# RLS policy CI gate — specification

> A real test runner needs a live Postgres, which is not available during Phase 1
> scaffolding. This file is the **precise** spec the Phase 1 CI job must implement
> once a throwaway Postgres (e.g. the `docker compose` service) is wired up. It is
> the security gate for multi-tenant isolation: **no org can read or write another
> org's rows on any tenant table.**

## What the gate proves

Row-Level Security (`sql/0003_rls.sql`) is the *only* thing standing between two
tenants' data. Application code is not trusted to scope queries. The gate must
fail the build if any tenant table is missing RLS, missing `FORCE`, or has a
policy that leaks across orgs.

## Preconditions / fixtures

1. Start an empty Postgres; apply migrations in order: `0001_init.sql`,
   `0002_pgvector.sql`, `0003_rls.sql`. (Skip `0002` only if the test image lacks
   pgvector; the RLS gate does not depend on the embedding column.)
2. The connection role used by the test **must not** be a superuser and **must
   not** have `BYPASSRLS` (otherwise `FORCE ROW LEVEL SECURITY` is bypassed and the
   gate is meaningless). Assert this in setup:
   - `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;`
     must return `(false, false)`.
3. Seed two orgs directly (as a privileged loader, or with the GUC set to each org
   in turn):
   - **ORG_1** = `a0000000-0000-4000-8000-000000000001` (the seed org), loaded via
     `sql/0100_seed.sql`.
   - **ORG_2** = a second org id, e.g. `a0000000-0000-4000-8000-000000000002`, with
     at least one row of its own in `loop`, `agent`, `task`, etc.

The tenant is selected per transaction with:

```sql
SET LOCAL app.current_org = '<org-uuid>';
-- or: SELECT set_config('app.current_org', '<org-uuid>', true);
```

## Tenant tables under test (every one must be asserted)

`org`, `app_user`, `loop`, `agent`, `subagent`, `task`, `run`, `event`, `metric`,
`memory`, `artifact`, `artifact_version`, `outcome`, `rubric`, `vault`.

The test should iterate this list programmatically rather than hand-coding each
table, so a newly added tenant table that forgets RLS automatically fails.

## Assertions

### A. Schema-level (structural)

For every table in the list above:

- `pg_class.relrowsecurity = true` (RLS enabled).
- `pg_class.relforcerowsecurity = true` (FORCE — owner is constrained too).
- At least one `pg_policy` row exists for the table.

Query:

```sql
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS n_policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname = ANY ($1);  -- the tenant table list
```

Fail if any row has `relrowsecurity = false`, `relforcerowsecurity = false`, or
`n_policies = 0`.

### B. Cross-org READ isolation (the core proof)

In a transaction with `SET LOCAL app.current_org = '<ORG_2>'`:

- For each tenant table, `SELECT count(*)` filtered to an **ORG_1**-owned key must
  return `0`. e.g.
  ```sql
  SET LOCAL app.current_org = 'a0000000-0000-4000-8000-000000000002';  -- ORG_2
  SELECT count(*) FROM loop  WHERE id = 'c0000000-0000-4000-8000-000000000002';  -- expect 0
  SELECT count(*) FROM task  WHERE org_id = 'a0000000-0000-4000-8000-000000000001'; -- expect 0
  -- …repeated for every tenant table
  ```
- Symmetrically, an **ORG_1** session must see its own rows (`> 0`) — proving the
  policy is not simply denying everything.

### C. Cross-org WRITE isolation

In an **ORG_2** session:

- **INSERT** of a row carrying `org_id = ORG_1` must be rejected by the policy's
  `WITH CHECK` (expect a `new row violates row-level security policy` error, or
  `0` rows affected for the conditional forms). Assert the insert does **not**
  succeed.
- **UPDATE** targeting an **ORG_1** row must affect `0` rows (the row is invisible
  under `USING`), e.g.
  ```sql
  UPDATE loop SET health = 0 WHERE id = 'c0000000-0000-4000-8000-000000000002';
  -- expect: UPDATE 0
  ```
- **UPDATE** that attempts to *move* an own row to `org_id = ORG_1` must be
  rejected by `WITH CHECK`.
- **DELETE** targeting an **ORG_1** row must affect `0` rows.

Then verify from an **ORG_1** session that the targeted ORG_1 rows are unchanged
(health not zeroed, row not deleted, no foreign ORG_1 rows created).

### D. Unset-GUC safety

With **no** `app.current_org` set on the connection:

- Every tenant `SELECT` returns `0` rows (because `current_setting('app.current_org', true)`
  is `NULL`, so `org_id = NULL` is never true). The build must confirm the missing
  GUC fails closed (no leak), not open and not erroring.

### E. Phase 4 rollup views honor RLS (security_invoker)

`sql/0005_rollup.sql` adds two regular views — `loop_tree` and `loop_rollup` —
created **`WITH (security_invoker = true)`** (PostgreSQL **15+**). Without that
option a view runs with the *definer's* rights and would bypass the querying
role's RLS, leaking every org's loops through the view. The gate must prove the
option is in force and that the views are tenant-scoped transitively.

Preconditions: same two orgs as §B (**ORG_1** = the seed org with the
`ceo → marketing → {comedeez, southbayitsolutions}` tree; **ORG_2** = a second org
with at least one root loop + a child of its own). Apply `0005_rollup.sql` after
`0003`/`0004`.

1. **Structural** — assert security_invoker is actually set (a misconfigured view
   silently leaks):

   ```sql
   SELECT c.relname, c.reloptions
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'v'
     AND c.relname IN ('loop_tree', 'loop_rollup');
   -- each reloptions array must contain 'security_invoker=true'
   ```

2. **Cross-org READ isolation through the views.** In an **ORG_2** session
   (`SET LOCAL app.current_org = '<ORG_2>'`):

   ```sql
   -- ORG_1's loops must be invisible through both views
   SELECT count(*) FROM loop_tree
     WHERE org_id = 'a0000000-0000-4000-8000-000000000001';        -- expect 0
   SELECT count(*) FROM loop_tree
     WHERE id = 'c0000000-0000-4000-8000-000000000002';            -- marketing → expect 0
   SELECT count(*) FROM loop_rollup
     WHERE org_id = 'a0000000-0000-4000-8000-000000000001';        -- expect 0
   SELECT count(*) FROM loop_rollup
     WHERE loop_id = 'c0000000-0000-4000-8000-000000000001';       -- CEO → expect 0
   ```

   Symmetrically, an **ORG_1** session must see its own rows (`> 0`) and the
   rollup/tree must be self-consistent — proving the views are not denying
   everything:

   ```sql
   SET LOCAL app.current_org = 'a0000000-0000-4000-8000-000000000001';  -- ORG_1
   -- CEO is the root; the tree exposes its descendants only within this org.
   SELECT depth, root_loop_id FROM loop_tree
     WHERE id = 'c0000000-0000-4000-8000-000000000002';   -- marketing: depth 1, root = CEO
   -- The CEO rollup aggregates its whole (ORG_1-only) subtree.
   SELECT descendant_count FROM loop_rollup
     WHERE loop_id = 'c0000000-0000-4000-8000-000000000001';   -- CEO: 3 (mkt+comedeez+southbay)
   ```

   The descendant_count for the CEO must equal the ORG_1 subtree size only — an
   ORG_2 loop must never inflate it (security_invoker scopes the recursive CTE's
   traversal to the caller's org, so foreign subtrees cannot bleed in).

3. **Unset-GUC safety** — with no `app.current_org` set, `SELECT count(*)` from
   both views returns `0` (the underlying `loop` RLS fails closed).

### F. Materialized view `org_health_daily` — APP-LEVEL org filter required

`org_health_daily` is a **MATERIALIZED VIEW**. Postgres does **not** support
`security_invoker` on a matview and does **not** allow `ENABLE ROW LEVEL SECURITY`
on one, so RLS **cannot** back-stop it. It is populated once by a **privileged
refresh role** (BYPASSRLS) and intentionally stores **every** org's daily health.

Document + assert (this is the only isolation for this object):

- The matview is **not** RLS-protected — `pg_class.relrowsecurity` is irrelevant
  for `relkind = 'm'`; do **not** add it to the §A tenant-table loop.
- The ANALYTICS read path **MUST** always filter:

  ```sql
  SELECT day, avg_health FROM org_health_daily
  WHERE org_id = current_setting('app.current_org', true)::uuid
  ORDER BY day;
  ```

  A read **without** that `org_id` predicate would expose other tenants' rows.
  Any gateway/repository query against `org_health_daily` that omits the org
  filter is a **leak** and must fail review/CI (e.g. a lint/grep gate over the
  analytics query layer).
- REFRESH must run as the privileged job, never the per-request connection:

  ```sql
  REFRESH MATERIALIZED VIEW CONCURRENTLY org_health_daily;  -- enabled by the unique (org_id,day) index
  ```

## Pass / fail

The gate **passes** only if A, B, C, and D all hold for **every** table in the
list, **and** E holds for `loop_tree` / `loop_rollup`. Any leak (a foreign-org row
visible, a cross-org write that succeeds, a table missing RLS/FORCE, or a rollup
view missing `security_invoker`) **fails the build**. F is an
app-level/read-path requirement for the matview rather than a row-policy
assertion, but the gate must confirm `org_health_daily` is never queried without
its `org_id` filter.

## Notes for the implementer

- Run each scenario in its own transaction and `ROLLBACK` so the gate is
  idempotent and order-independent.
- Drive it from the gateway's test stack (NestJS + `pg`) or a thin `psql`-based
  script; the assertions are pure SQL + row-count checks, no ORM required.
- Keep the tenant-table list in one shared constant so schema and CI never drift.
