# Runbook — Deployment & Rollback

## Prerequisites

- CI green: typecheck + lint + unit + the RLS/`(model,knob)` gates + `next build`.
- Migrations reviewed (`packages/db/sql/*`), applied in order, idempotent.
- Secrets present in the cluster secret manager (`departments-secrets`) — never committed;
  agent creds live in CMA Vaults (egress injection), not env.

## Deploy

1. **Migrate** (privileged role): apply `0001`→`0006`. `0006_audit.sql` adds the
   immutability triggers + audit log — verify it ran (the `*_immutable` triggers exist).
2. **Apply manifests**:
   ```bash
   kubectl apply -f infra/k8s/                 # base Deployments + Services
   kubectl apply -f infra/k8s/production.yaml  # HPA, PDB, ConfigMap, Secret template
   kubectl apply -f infra/k8s/alerting.yaml    # PrometheusRule
   ```
3. **Provision agents** (one-time / on roster change) from version-controlled YAML:
   `scripts/provision.ts --apply` (needs `ANTHROPIC_API_KEY`; CMA Scheduled Deployments +
   the HMAC webhook bridge). Never per-tick.
4. **Bracket with an audit checkpoint** (see [RLS_AUDIT](./RLS_AUDIT.md)): insert a
   pre-deploy `audit_snapshot`, run the RLS gate, insert a post-deploy snapshot.
5. **Smoke**: `GET /health` returns `{ status: 'ok', protocol: 1 }`; the cockpit connects
   over `/ws` and a `loop <name>` run streams events.

## Roll back

- `kubectl rollout undo deployment/<gateway|orchestrator|web>`.
- Migrations are forward-only; a bad migration is fixed with a new compensating migration,
  never an in-place edit (the spines are append-only). For an emergency stop, use the
  [KILL_SWITCH](./KILL_SWITCH.md) (org cap → 0 or scale orchestrator to 0).

## Staged rollout

Ship behind the org/loop budget caps + the no-progress detector as a built-in blast-radius
limiter: a bad release that spins or overspends auto-pauses rather than runs away. Watch
the Phase-5 alerts (`infra/k8s/alerting.yaml`) through the first cycles.
