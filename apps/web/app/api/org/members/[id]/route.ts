/**
 * /api/org/members/[id]
 *
 *   PATCH  → change a member's role ({ role }).
 *   DELETE → remove a member, refused for the last owner or yourself (409).
 */
import { deleteMember, setMemberRole } from '@/lib/server/db';
import { USER_ROLES, type UserRole } from '@departments/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const role = body.role;
  if (typeof role !== 'string' || !(USER_ROLES as readonly string[]).includes(role)) {
    return Response.json({ error: 'a valid role is required' }, { status: 400 });
  }
  const member = setMemberRole(id, role as UserRole);
  if (!member) return Response.json({ error: 'no such member' }, { status: 404 });
  return Response.json({ member });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = deleteMember(id);
  if (!result.ok) {
    const status = result.reason === 'no such member' ? 404 : 409;
    return Response.json({ error: result.reason }, { status });
  }
  return Response.json({ ok: true });
}
