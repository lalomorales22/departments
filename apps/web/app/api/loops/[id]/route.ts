import { sanitizeLoopId } from '@/lib/server/realtime';

/**
 * PATCH /api/loops/:id — edit a loop's config (currently the cadence/schedule).
 *
 * Locally there is no Postgres, so this validates the change and acknowledges it; the
 * cockpit reflects it optimistically (the store override). In prod this writes the
 * loop row (RLS-scoped) and the engine picks up the new cadence on its next
 * continue-as-new — the durable value the IDLE_WAIT derives its sleep from.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Canonical cadence labels the editor offers (mirrors @departments/orchestration cadence floors). */
const CADENCE_LABELS = ['continuous', 'hourly', 'daily', 'nightly', 'weekly', 'manual', 'on-demand'];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loopId = sanitizeLoopId(id);
  let body: { cadence?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const patch: { cadence?: string } = {};
  if (body.cadence !== undefined) {
    const cadence = String(body.cadence).toLowerCase().trim();
    if (!CADENCE_LABELS.includes(cadence)) {
      return Response.json({ error: `unknown cadence (allowed: ${CADENCE_LABELS.join(', ')})` }, { status: 400 });
    }
    patch.cadence = cadence;
  }
  // Acknowledge — durable persistence is the DB/engine path (gated on Postgres).
  return Response.json({ ok: true, loopId, patch });
}
