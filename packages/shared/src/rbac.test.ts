import { describe, expect, it } from 'vitest';
import { USER_ROLES } from './enums';
import {
  CAPABILITIES,
  ROLES_BY_SENIORITY,
  can,
  canAssignRole,
  capabilitiesOf,
  roleAtLeast,
} from './rbac';

describe('RBAC capability matrix', () => {
  it('Owner is a strict superset of Commander', () => {
    for (const cap of capabilitiesOf('commander')) {
      expect(can('owner', cap)).toBe(true);
    }
    // Owner holds at least one capability Commander does not (org admin).
    expect(can('owner', 'members.manage')).toBe(true);
    expect(can('commander', 'members.manage')).toBe(false);
  });

  it('Commander holds the kill switch + the approval gates; Operator does not', () => {
    expect(can('commander', 'loop.stop')).toBe(true);
    expect(can('commander', 'approval.tool')).toBe(true);
    expect(can('commander', 'approval.spawn')).toBe(true);
    expect(can('operator', 'loop.stop')).toBe(false);
    expect(can('operator', 'approval.tool')).toBe(false);
  });

  it('Operator can act within a loop (run/step/import) but not administer the org', () => {
    expect(can('operator', 'loop.run')).toBe(true);
    expect(can('operator', 'loop.step')).toBe(true);
    expect(can('operator', 'artifact.import')).toBe(true);
    expect(can('operator', 'billing.manage')).toBe(false);
    expect(can('operator', 'role.assign')).toBe(false);
  });

  it('Viewer is read-only', () => {
    expect(can('viewer', 'loop.view')).toBe(true);
    expect(can('viewer', 'analytics.view')).toBe(true);
    expect(can('viewer', 'loop.run')).toBe(false);
    expect(can('viewer', 'artifact.import')).toBe(false);
    expect(can('viewer', 'loop.stop')).toBe(false);
  });

  it('every role can at least view a loop', () => {
    for (const role of USER_ROLES) expect(can(role, 'loop.view')).toBe(true);
  });

  it('capabilitiesOf returns capabilities in declaration order', () => {
    const caps = capabilitiesOf('owner');
    const indices = caps.map((c) => CAPABILITIES.indexOf(c));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    // Owner holds all capabilities.
    expect(caps.length).toBe(CAPABILITIES.length);
  });
});

describe('role seniority + assignment', () => {
  it('roleAtLeast respects the operational ladder', () => {
    expect(roleAtLeast('commander', 'operator')).toBe(true);
    expect(roleAtLeast('operator', 'commander')).toBe(false);
    expect(roleAtLeast('owner', 'owner')).toBe(true);
  });

  it('ROLES_BY_SENIORITY is most-senior first', () => {
    expect(ROLES_BY_SENIORITY[0]).toBe('owner');
    expect(ROLES_BY_SENIORITY.at(-1)).toBe('viewer');
  });

  it('only grants a role strictly below the actor (no privilege escalation)', () => {
    // Owner can mint a Commander…
    expect(canAssignRole('owner', 'commander')).toBe(true);
    // …but a Commander cannot mint an Owner or another Commander.
    expect(canAssignRole('commander', 'owner')).toBe(false);
    expect(canAssignRole('commander', 'commander')).toBe(false);
    // Operator can't assign roles at all (lacks role.assign).
    expect(canAssignRole('operator', 'viewer')).toBe(false);
  });
});
