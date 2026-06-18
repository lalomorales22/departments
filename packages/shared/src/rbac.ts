/**
 * RBAC — the capability matrix that turns the four {@link UserRole}s into concrete,
 * checkable permissions.
 *
 * Phase 1 froze the *roles* (`owner|commander|operator|viewer`); Phase 5 makes them
 * load-bearing: the cockpit gates every action through {@link can}, and the gateway
 * enforces the SAME matrix server-side (a client-side hide is cosmetic — the
 * authoritative check is on the API). This module is the single source of truth both
 * sides import, so "what an Operator may do" can never drift between UI and API.
 *
 * Precedence note (README → human-on-top guardrails): the Commander holds the kill
 * switch and is the ONLY role that may answer an `always_ask` tool gate or a
 * child-spawn approval. The Owner is a strict superset (org administration on top).
 * Roles are a total order owner ⊇ commander ⊇ operator ⊇ viewer for *operational*
 * actions, but org-administration capabilities are Owner-only (not on the operational
 * ladder), so the matrix is declared explicitly rather than derived from the rank.
 */
import { USER_ROLES, type UserRole } from './enums';

/**
 * Every gated action in the product. Names are `subject.verb`; the cockpit and the
 * gateway both reference these exact strings, so adding a capability here is the one
 * edit that surfaces it on both sides.
 */
export const CAPABILITIES = [
  // ── Loop lifecycle (the transport bar + command bar) ──
  'loop.run', // fire run_now / start a cycle
  'loop.pause', // pause a running loop (part of the kill switch)
  'loop.stop', // stop a loop (the kill switch)
  'loop.step', // advance one phase in manual STEP mode
  'loop.spawn', // request a child loop (still subject to the spawn approval gate)
  // ── Human-on-top approval gates (Commander-only; the kill switch) ──
  'approval.tool', // answer an `always_ask` irreversible-tool confirmation
  'approval.spawn', // approve/deny a child-spawn request
  // ── Configuration ──
  'loop.config.edit', // edit cadence / run mode / per-loop settings
  'gate.threshold.edit', // tune the four-gate pass thresholds
  'budget.cap.edit', // change loop/org soft + hard budget caps
  'fable.approve', // approve the gated Fable-5 (greenfield-strategy) cost path
  // ── Artifacts ──
  'artifact.import', // ⌘I import an artifact (writes + commits)
  'artifact.screenshot', // capture the workspace to a versioned artifact
  // ── Org administration (Owner-only) ──
  'members.view', // see the Members & Roles roster
  'members.manage', // invite / remove members
  'role.assign', // change another member's role
  'billing.manage', // edit the plan, limits, and billing
  'integrations.manage', // manage third-party API keys / vault bindings
  // ── Read ──
  'analytics.view', // org KPIs + per-loop comparison
  'loop.view', // observe a loop (always on, even for viewers)
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Read-only capabilities every authenticated role holds. */
const VIEWER: readonly Capability[] = ['loop.view', 'analytics.view', 'members.view'];

/**
 * Operator — "acts within an assigned loop." Can drive a loop's day-to-day work and
 * import artifacts, but cannot answer the human-on-top approval gates (those are the
 * Commander's kill-switch authority) and cannot administer the org.
 */
const OPERATOR: readonly Capability[] = [
  ...VIEWER,
  'loop.run',
  'loop.step',
  'loop.config.edit',
  'artifact.import',
  'artifact.screenshot',
];

/**
 * Commander — holds the kill switch and every operational + approval authority, but
 * NOT org administration (members/roles/billing/integrations are the Owner's).
 */
const COMMANDER: readonly Capability[] = [
  ...OPERATOR,
  'loop.pause',
  'loop.stop',
  'loop.spawn',
  'approval.tool',
  'approval.spawn',
  'gate.threshold.edit',
  'budget.cap.edit',
  'fable.approve',
];

/** Owner — a strict superset of Commander plus org administration. */
const OWNER: readonly Capability[] = [
  ...COMMANDER,
  'members.manage',
  'role.assign',
  'billing.manage',
  'integrations.manage',
];

/**
 * The authoritative role → capability matrix. Frozen `Set`s for O(1) `has` checks;
 * both the cockpit and the gateway import this exact object.
 */
export const RBAC_MATRIX: Readonly<Record<UserRole, ReadonlySet<Capability>>> = {
  viewer: new Set(VIEWER),
  operator: new Set(OPERATOR),
  commander: new Set(COMMANDER),
  owner: new Set(OWNER),
};

/** Whether a role holds a capability — the single check both sides call. */
export function can(role: UserRole, capability: Capability): boolean {
  return RBAC_MATRIX[role]?.has(capability) ?? false;
}

/** All capabilities a role holds, in declaration order (stable for UI rendering). */
export function capabilitiesOf(role: UserRole): Capability[] {
  const held = RBAC_MATRIX[role];
  return CAPABILITIES.filter((c) => held.has(c));
}

/**
 * Operational seniority rank (owner=3 … viewer=0). Use for "at least Operator"-style
 * gates and for deciding whether a role may *assign* another role (you can only grant
 * a role strictly below your own — enforced alongside the `role.assign` capability).
 */
export const ROLE_RANK: Readonly<Record<UserRole, number>> = {
  viewer: 0,
  operator: 1,
  commander: 2,
  owner: 3,
};

/** True iff `role` is at least as senior as `min` on the operational ladder. */
export function roleAtLeast(role: UserRole, min: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Whether `actor` may set `target`'s role to `next`: must hold `role.assign` AND only
 * grant a role strictly below the actor's own rank (an Owner can mint Commanders, a
 * Commander can never mint an Owner or another Commander). Prevents privilege
 * escalation through the Members & Roles UI.
 */
export function canAssignRole(actor: UserRole, next: UserRole): boolean {
  if (!can(actor, 'role.assign')) return false;
  return ROLE_RANK[next] < ROLE_RANK[actor];
}

/** Human-readable role label for the UI (single source so casing never drifts). */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  commander: 'Commander',
  operator: 'Operator',
  viewer: 'Viewer',
};

/** All roles, most-senior first — for role pickers/menus. */
export const ROLES_BY_SENIORITY: readonly UserRole[] = [...USER_ROLES].sort(
  (a, b) => ROLE_RANK[b] - ROLE_RANK[a],
);
