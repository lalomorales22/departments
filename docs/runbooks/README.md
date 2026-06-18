# ◈ Departments — Operational Runbooks

Launch + incident runbooks for the platform. Each is a flat checklist: **detect →
contain → diagnose → recover → verify**. They pair with the in-app guardrails
(`@departments/shared/alerts`, the engine's `AlertSink`) and the Prometheus rules in
[`infra/k8s/alerting.yaml`](../../infra/k8s/alerting.yaml).

| Runbook | When | Alert |
|---|---|---|
| [KILL_SWITCH](./KILL_SWITCH.md) | A loop (or the whole org) must stop NOW | manual |
| [RUNAWAY_LOOP](./RUNAWAY_LOOP.md) | A loop spins/spends/spawns out of control | `LoopNoProgressPaused`, `OrgBudgetHardCapBreached` |
| [TENANT_ISOLATION_INCIDENT](./TENANT_ISOLATION_INCIDENT.md) | Suspected cross-tenant leak | `RLSViolation` |
| [REFUSAL_STORM](./REFUSAL_STORM.md) | A burst of model refusals | `RefusalStorm` |
| [COST_GOVERNANCE](./COST_GOVERNANCE.md) | Spend/cache anomalies; cap tuning | `OrgBudget*`, `PromptCacheDegraded` |
| [RLS_AUDIT](./RLS_AUDIT.md) | Verify tenant isolation + append-only integrity | CI gate |
| [DEPLOYMENT](./DEPLOYMENT.md) | Ship / roll back a release | — |

## The precedence rule (binding, everywhere)

**Cost caps and human gates OVERRIDE autonomy and capability escalation.** A hard-cap
pause and a Commander deny always win; an escalation bump can never breach a hard cap.
Every runbook below assumes this — never "work around" a cap or a gate to keep a loop
running.

## Who can do what

Operational actions are gated by the RBAC matrix (`@departments/shared/rbac`), enforced
server-side by the gateway `RbacGuard`. The **Commander holds the kill switch** and the
`always_ask` / spawn approval gates; the **Owner** adds org administration. Operators act
within a loop; Viewers are read-only.
