'use client';

/**
 * Client-side RBAC hooks. These gate the UI (hide/disable actions a role can't take)
 * against the SAME {@link RBAC_MATRIX} the gateway enforces server-side — a hidden
 * button is cosmetic; the authoritative check is on the API. Importing the shared
 * matrix keeps "what an Operator may do" identical on both sides.
 */
import { can, type Capability, type UserRole } from '@departments/shared';
import { useCockpit } from './store';

/** The acting user's current role. */
export function useUserRole(): UserRole {
  return useCockpit((s) => s.userRole);
}

/** Whether the acting role holds a capability. */
export function useCan(capability: Capability): boolean {
  const role = useCockpit((s) => s.userRole);
  return can(role, capability);
}

/** A reason string for a disabled control, naming the lowest role that holds the cap. */
export function deniedReason(capability: Capability): string {
  // The matrix is a near-superset ladder; commander holds the approval/kill-switch caps,
  // operator the day-to-day ones. Surface a helpful "requires …" hint.
  const operatorCaps: Capability[] = ['loop.run', 'loop.step', 'loop.config.edit', 'artifact.import', 'artifact.screenshot'];
  if (operatorCaps.includes(capability)) return 'Requires Operator or higher';
  return 'Requires Commander';
}
