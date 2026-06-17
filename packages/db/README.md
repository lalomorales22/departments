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
