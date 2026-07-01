/**
 * /api/org/members — the org roster (real, SQLite-backed; no fixtures).
 *
 *   GET  → list every member of the local workspace (seeded with just the commander).
 *   POST → add a member ({ name, email, role }). Role must be a valid UserRole.
 */
import { randomUUID } from 'node:crypto';
import { createMember, listMembers } from '@/lib/server/db';
import { LOCAL_ORG_ID } from '@/lib/workspace';
import { USER_ROLES, type UserRole } from '@departments/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ members: listMembers(LOCAL_ORG_ID) });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const role = body.role;
  if (!name) return Response.json({ error: 'a name is required' }, { status: 400 });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: 'a valid email is required' }, { status: 400 });
  }
  if (typeof role !== 'string' || !(USER_ROLES as readonly string[]).includes(role)) {
    return Response.json({ error: 'a valid role is required' }, { status: 400 });
  }

  const slug = (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const member = createMember({
    id: `user-${slug || 'member'}-${randomUUID().slice(0, 8)}`,
    orgId: LOCAL_ORG_ID,
    name,
    email,
    role: role as UserRole,
    now: new Date().toISOString(),
  });
  return Response.json({ member }, { status: 201 });
}
