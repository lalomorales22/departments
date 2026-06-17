# infra/k8s — Deployment SKELETONS

> ⚠️ **Skeletons, not production manifests.** These files exist to commit the
> deployment topology (three services + their wiring) early. They are deliberately
> minimal: no Ingress, no HPA, no TLS, no resource tuning, placeholder images, and
> secrets referenced but not defined. Do not `kubectl apply` these as-is.

## What's here

| File                              | Workload                  | Port | Notes |
| --------------------------------- | ------------------------- | ---- | ----- |
| `web.deployment.yaml`             | `@departments/web` (Next) | 3000 | Public cockpit UI. |
| `gateway.deployment.yaml`         | `@departments/gateway`    | 4000 | API + WS hub. Liveness on `/health`. |
| `orchestrator.deployment.yaml`    | `@departments/orchestrator` | —  | Temporal worker host. No inbound Service (worker only). |

Each file contains a `Deployment` and (where it serves inbound traffic) a
ClusterIP `Service`.

## Config & secrets (TODO before real use)

- Build + push real images and replace the `image:` placeholders.
- Provide env via a `ConfigMap` (non-secret) + `Secret` (`DATABASE_URL`,
  `REDIS_URL`, `TEMPORAL_ADDRESS`, S3/MinIO creds, `ANTHROPIC_API_KEY`).
  See [`.env.example`](../../.env.example) for the full variable list.
- Add an `Ingress`/Gateway for `web` and `gateway`; keep `orchestrator` internal.
- Add `resources` requests/limits, `HorizontalPodAutoscaler`, and readiness gates.
- Wire RLS org-context + KMS (secret material lives in CMA Vaults, never in pods).

## Phasing

Phase 1 runs everything locally via [`docker-compose.yml`](../../docker-compose.yml).
These k8s skeletons are the target shape for Phase 2+ cluster deploys.
