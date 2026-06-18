# `@departments/db`

The Postgres schema, migrations, RLS policies, and demo seed for **Departments**.
This package is **SQL-only** — there are no runtime dependencies and no build
step. It owns the relational core that mirrors
[`packages/shared/src/types.ts`](../shared/src/types.ts) and the README
[Data model](../../README.md#data-model).

## Layout

```
packages/db/
├── package.json
├── sql/
│   ├── 0001_init.sql       # enums + all tables + indexes (no pgvector dependency)
│   ├── 0002_pgvector.sql   # CREATE EXTENSION vector; memory.embedding + ivfflat index
│   ├── 0003_rls.sql        # ENABLE + FORCE RLS + per-org isolation policy on every tenant table
│   ├── 0004_metric_unique.sql # UNIQUE(loop_id, key) for "latest metric" upserts
│   ├── 0005_rollup.sql     # Phase 4: loop_tree + loop_rollup views (security_invoker) + org_health_daily matview
│   └── 0100_seed.sql       # demo seed: South Bay IT Solutions org + marketing loop tree
├── test/
│   └── rls.policy.test.md  # spec for the RLS CI gate (no live Postgres in P1)
└── README.md
```

Migrations apply in **filename order**. `0001`–`0003` are schema; `01xx` are data
(seed). Keep new schema migrations in the `0NNN_` range and seeds in `01NN_`.

## Applying migrations

There is no bundled runner yet (Phase 1 is scaffolding). `pnpm db:migrate` is a
placeholder that prints how to apply `sql/`. Until a runner lands, apply with
`psql` against the local Postgres started by `docker compose up -d`:

```bash
# from the monorepo root, with $DATABASE_URL pointing at the local Postgres
for f in packages/db/sql/0001_init.sql \
         packages/db/sql/0002_pgvector.sql \
         packages/db/sql/0003_rls.sql \
         packages/db/sql/0100_seed.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

- `0002_pgvector.sql` requires the **pgvector** extension to be available in the
  image (the `docker compose` Postgres provides it). The core schema (`0001`) does
  **not** depend on pgvector, so it can be applied/linted standalone.
- A future migration runner should record applied files in a `schema_migrations`
  table; the filenames are already monotonic and safe to use as version keys.

## Canonical phase vocabulary (do not let this drift)

The `phase` enum includes both `bootstrap` (the resumable cold-start) and
`improve`. The engine persists **`improve`**; the UI pipeline renders that same
stage as **`OPTIMIZE`**. They are the same thing. The single label↔phase↔color
map lives in [`packages/shared/src/pipeline.ts`](../shared/src/pipeline.ts) — never
hardcode the mapping in SQL or anywhere else. There is no `optimize` value in the
database.

## The RLS multi-tenancy model

Tenant isolation is enforced **at the row**, not in application code:

- Every tenant table carries `org_id NOT NULL REFERENCES org(id)`.
- `0003_rls.sql` runs `ENABLE` **and** `FORCE ROW LEVEL SECURITY` on every tenant
  table, plus one policy per table that constrains all of
  `SELECT / INSERT / UPDATE / DELETE` to
  `org_id = current_setting('app.current_org', true)::uuid`. (`org` itself is
  scoped on `id` since it is the tenant root.)
- The current org is set **per request** by the NestJS gateway, inside the
  request transaction, after authenticating the caller:

  ```sql
  SET LOCAL app.current_org = '<org-uuid>';
  -- or: SELECT set_config('app.current_org', '<org-uuid>', true);
  ```

- The policies read that GUC with the `missing_ok = true` form
  (`current_setting('app.current_org', true)`), so an **unscoped** connection
  fails **closed** — it sees zero rows instead of leaking or erroring.

### Operational requirements

- The gateway's request connection role **must not** be a superuser and **must
  not** have `BYPASSRLS` — `FORCE ROW LEVEL SECURITY` is only meaningful for roles
  that cannot bypass it.
- A separate, privileged loader role (with `BYPASSRLS`) may be used for bulk seed
  / cross-org maintenance. `0100_seed.sql` instead pins `app.current_org` to the
  South Bay org for its transaction, so it also loads under a non-bypass role.

### CI gate

[`test/rls.policy.test.md`](./test/rls.policy.test.md) specifies the security gate
the Phase 1 CI must implement once a throwaway Postgres is available: it must prove
that an `org-2` session can neither read nor write any `org-1` row on **every**
tenant table, that RLS + FORCE are enabled everywhere, and that an unset GUC fails
closed.

## The demo seed

`0100_seed.sql` mirrors `apps/web/lib/fixtures/*` so the seeded database matches
the Phase 1 cockpit: one org (**South Bay IT Solutions**), the **Commander** user,
the `ceo → marketing → {comedeez, southbayitsolutions}` loop tree, the canonical
**8 marketing agents** (5 running / 3 idle), a **5 / 4 / 2 / 4** Kanban (15 tasks),
**6 metric cards** (`bounce_rate` and `cac` have `good_direction = down`), **5
artifacts**, and **5 memory rows**. All `created_at` values are current-era
(**2026**). UUIDs are fixed for deterministic, idempotent FKs.

## Phase 4 rollups & tree (`0005_rollup.sql`)

The hierarchy/meta-loop read side. Three objects power the HIERARCHY panel and the
ANALYTICS tab without recomputing tree walks in application code:

- **`loop_tree`** (VIEW) — a recursive-CTE materialization of the loop tree. Per
  loop: `id, org_id, parent_loop_id, root_loop_id, depth` (root = 0), `level`
  (1..4), and `path` (the inclusive ancestor `uuid[]` from root → loop). Drives the
  hierarchy panel.
- **`loop_rollup`** (VIEW) — per-loop **subtree** aggregates (the loop itself + all
  descendants): `rolled_health` (avg health), `rolled_spent_usd` and
  `rolled_budget_usd` (sums), `descendant_count` (strict descendants), and
  `worst_status` — the most attention-needing `loop_status` in the subtree, ranked
  **error > paused > running > idle > stopped** via a CASE severity score.
- **`org_health_daily`** (MATERIALIZED VIEW) — the ANALYTICS "aggregate health over
  time" series: per `(org_id, day)` the `avg(metric.value)` where `key = 'health'`,
  bucketed by `date_trunc('day', ts)`. A `UNIQUE (org_id, day)` index enables
  `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Refresh cadence: a **privileged**
  scheduled job, **nightly** baseline (plus an extra refresh after large metric
  backfills).

### The `security_invoker` decision (tenant isolation across views)

A regular Postgres view runs with its **definer's** rights and therefore **bypasses
the querying role's RLS** by default — a scoped session reading `loop_tree` would
otherwise see *every* org's loops. To preserve the multi-tenancy model
(`0003_rls.sql`), `loop_tree` and `loop_rollup` are created
**`WITH (security_invoker = true)`** (**PostgreSQL 15+**): the view body executes
under the *caller's* permissions and RLS, so `loop_isolation` (and `metric_isolation`)
apply transitively and the recursive walks never bleed across tenants. Both views
also carry `org_id`. **Do not back-port below PG 15** — the option is unknown there
and `CREATE VIEW` would error.

A **materialized view cannot** be `security_invoker` and cannot have RLS enabled, so
`org_health_daily` is **not** RLS-protected: it is refreshed by a privileged
(BYPASSRLS) job and stores every org's daily health by design. Its tenant isolation
is therefore an **app-level read-path requirement** — the ANALYTICS query **must**
always filter `org_id = current_setting('app.current_org', true)::uuid`. This is
documented in the matview's `COMMENT` and asserted in
[`test/rls.policy.test.md`](./test/rls.policy.test.md) (§E for the views, §F for the
matview).

All `0005` statements are idempotent: `CREATE OR REPLACE VIEW` for the views,
`DROP MATERIALIZED VIEW IF EXISTS` + `CREATE` for the matview (its column set may
evolve), and `CREATE [UNIQUE] INDEX IF NOT EXISTS` for its indexes.
