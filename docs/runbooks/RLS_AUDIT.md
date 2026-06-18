# Runbook — RLS + Append-Only Audit (CI gate + periodic verification)

Proves tenant isolation and tamper-evidence hold. Runs as a **CI gate from migration #1**
and on demand before/after a deploy.

## What it asserts (full spec: `packages/db/test/rls.policy.test.md`)

- **§A–§D** — every tenant table has `ENABLE` + `FORCE ROW LEVEL SECURITY` and ≥1 policy;
  org-2 sees zero org-1 rows; cross-org writes are rejected (`WITH CHECK`).
- **§E** — `loop_tree` / `loop_rollup` are `security_invoker` (PG15+), so RLS applies
  transitively through the views.
- **§F** — `org_health_daily` (matview, NOT RLS-protected) is NEVER read without an
  explicit `org_id` filter.
- **§G (Phase 5)** — append-only integrity:
  - immutability triggers exist on `event`/`run`/`artifact_version`/`audit_log` and reject
    `UPDATE`/`DELETE` from the request role;
  - `event` `seq` is unique per loop + the app hash chain (`@departments/events/audit`)
    re-derives clean (content/insert/delete/reorder all detected);
  - `audit_log` records control-plane changes with `old`/`new` + `changed_by`;
  - `rls_violation_audit` is empty.

## Run it

1. Apply migrations to a scratch DB (`0001`→`0006`, then `0100_seed.sql` via the
   **privileged** loader role only).
2. Drive the scenarios from the gateway test stack (NestJS + `pg`) or a `psql` script —
   each scenario in its own transaction with `ROLLBACK` so the gate is idempotent.
3. Scope a session: `SELECT set_config('app.current_org', '<org-uuid>', true);` (do NOT set
   `app.allow_purge`).
4. Assert every §A–§G check; ANY leak fails the build.

## Checkpoints

Bracket each deploy: insert an `audit_snapshot` (`rls_enforcement_ok = true`,
`mutation_count`) before and after. A drift between checkpoints (unexpected mutations, a
non-empty `rls_violation_audit`) escalates to
[TENANT_ISOLATION_INCIDENT](./TENANT_ISOLATION_INCIDENT.md).

## The two roles (do not conflate)

- **Request role** (gateway): NOT superuser, NO BYPASSRLS, never sets `app.allow_purge`.
- **Privileged role**: BYPASSRLS — `0100_seed.sql`, `REFRESH MATERIALIZED VIEW
  CONCURRENTLY org_health_daily`, and controlled retention/admin purges (sets
  `app.allow_purge = 'on'`) ONLY.
