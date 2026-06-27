import type { Org, User } from '@departments/shared';

/**
 * The single local workspace identity. This is REAL (your own workspace), not fixture
 * demo data — there is one org and one commander for the local single-user cockpit. Multi
 * tenancy + auth is the later prod milestone; here the org scopes the SQLite rows.
 */
export const LOCAL_ORG_ID = 'org-local';

export const LOCAL_ORG: Org = {
  id: LOCAL_ORG_ID,
  name: 'My Workspace',
  slug: 'local',
  createdAt: '2026-01-01T00:00:00Z',
};

export const LOCAL_COMMANDER: User = {
  id: 'user-local',
  orgId: LOCAL_ORG_ID,
  name: 'Commander',
  email: 'southbayitsolutions619@gmail.com',
  role: 'commander',
  initials: 'CM',
  createdAt: '2026-01-01T00:00:00Z',
};

/** Slugify a free-text loop name into a stable id-safe handle. */
export function slugifyLoopName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Title-case a slug for display (`content-creator` → `Content Creator`). */
export function displayNameFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
