# Runbook — Tenant-Isolation Incident (suspected cross-tenant leak)

The highest-severity class. Treat any `RLSViolation` alert (or a report of org-A data
visible to org-B) as a **critical security incident**.

## Detect

- `RLSViolation` — `rls_violation_audit` (0006_audit.sql) returned a non-empty set
  (a child row whose `org_id` ≠ its parent's). This view should ALWAYS be empty.
- A user reports seeing another org's loops/metrics/artifacts.

## Contain (minutes matter)

1. **Freeze the blast radius.** If a specific org pair is implicated, pause those orgs'
   loops (see [KILL_SWITCH](./KILL_SWITCH.md) → org-wide).
2. **Check the connection role.** The #1 cause of an RLS bypass is a privileged DB
   connection on the request path. Confirm the gateway's `DATABASE_URL` role is **NOT a
   superuser and does NOT have BYPASSRLS** (only `DATABASE_URL_PRIVILEGED` may, and only
   for matview refresh / admin purge — never per-request).
3. **Confirm the GUC is set per request.** The `OrgContextInterceptor` must run
   `set_config('app.current_org', <orgId>, true)` inside each request's transaction. A
   missing GUC fails CLOSED (policies see `NULL` → zero rows), so a leak means the GUC was
   set to the WRONG org — audit the auth middleware's org resolution.

## Diagnose

1. As a scoped session, run the §G checks in
   [`packages/db/test/rls.policy.test.md`](../../packages/db/test/rls.policy.test.md):
   `SELECT count(*) FROM rls_violation_audit` (must be 0), and the structural checks
   (`relrowsecurity` + `relforcerowsecurity` + ≥1 policy on every tenant table).
2. Find the offending rows: `SELECT * FROM rls_violation_audit` names the table, record id,
   and conflicting org.
3. Cross-check `audit_log` (0006) for the write that introduced the mismatch — `old_values`
   / `new_values` + `changed_by` reconstruct exactly who did what.
4. If `org_health_daily` (matview, NOT RLS-protected) was queried without its explicit
   `org_id` filter, that read path is the leak — grep the analytics query layer.

## Recover + verify

- Patch the offending code path (role, GUC, or a missing `org_id` filter on the matview).
- Quarantine/correct the mismatched rows under `app.allow_purge` (the only way to mutate
  the append-only spines), recording the action.
- Re-run the §A–§G RLS gate; insert a fresh `audit_snapshot` with `rls_enforcement_ok =
  true` to bracket the fix. Notify affected tenants per policy.
