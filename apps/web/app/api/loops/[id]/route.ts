import { sanitizeLoopId } from '@/lib/server/realtime';
import { deleteLoop, getLoopRow, patchLoop } from '@/lib/server/db';

/**
 * /api/loops/:id — read, edit, or delete a single loop. Real SQLite writes now (Phase C):
 *
 *   GET    → the loop row, or 404.
 *   PATCH  → durably edit config (cadence / mission / displayName / budget). The engine
 *            picks up the new cadence on its next continue-as-new in the durable path.
 *   DELETE → remove the loop and its persisted event history (git artifacts on disk are
 *            left in place; clearing those is a separate, explicit action).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Canonical cadence labels the editor offers (mirrors @departments/orchestration cadence floors). */
const CADENCE_LABELS = ['continuous', 'hourly', 'daily', 'nightly', 'weekly', 'manual', 'on-demand'];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loop = getLoopRow(sanitizeLoopId(id));
  return loop ? Response.json({ loop }) : Response.json({ error: 'not found' }, { status: 404 });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loopId = sanitizeLoopId(id);
  let body: { cadence?: unknown; mission?: unknown; displayName?: unknown; budgetCapUsd?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const patch: { cadence?: string; mission?: string; displayName?: string; budgetCapUsd?: number } = {};
  if (body.cadence !== undefined) {
    const cadence = String(body.cadence).toLowerCase().trim();
    if (!CADENCE_LABELS.includes(cadence)) {
      return Response.json({ error: `unknown cadence (allowed: ${CADENCE_LABELS.join(', ')})` }, { status: 400 });
    }
    patch.cadence = cadence;
  }
  if (typeof body.mission === 'string' && body.mission.trim()) patch.mission = body.mission.trim();
  if (typeof body.displayName === 'string' && body.displayName.trim()) patch.displayName = body.displayName.trim();
  if (typeof body.budgetCapUsd === 'number' && body.budgetCapUsd >= 0) patch.budgetCapUsd = body.budgetCapUsd;

  const loop = patchLoop(loopId, patch, new Date().toISOString());
  return loop ? Response.json({ ok: true, loop }) : Response.json({ error: 'not found' }, { status: 404 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loopId = sanitizeLoopId(id);
  if (!getLoopRow(loopId)) return Response.json({ error: 'not found' }, { status: 404 });
  deleteLoop(loopId);
  return Response.json({ ok: true, deleted: loopId });
}
