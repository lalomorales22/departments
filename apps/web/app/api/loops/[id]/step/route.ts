import { serverRealtime, sanitizeLoopId } from '@/lib/server/realtime';

/**
 * POST /api/loops/:id/step — advance a STEP-mode run by one phase.
 *
 * The cockpit's pipeline AUTO↔STEP toggle starts the run with `?mode=step`; the engine
 * then pauses before each phase awaiting a newline on its stdin. This route writes that
 * newline to the live subprocess, releasing exactly one phase. Returns 409 if there is
 * no step-mode run for the loop.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loopId = sanitizeLoopId(id);
  const handle = serverRealtime().runs.get(loopId);

  if (!handle) {
    return Response.json({ stepped: false, reason: 'no-active-run' }, { status: 409 });
  }
  if (handle.mode !== 'step') {
    return Response.json({ stepped: false, reason: 'not-step-mode' }, { status: 409 });
  }

  try {
    handle.child.stdin.write('\n');
  } catch (e) {
    return Response.json(
      { stepped: false, reason: e instanceof Error ? e.message : 'write-failed' },
      { status: 500 },
    );
  }
  return Response.json({ stepped: true });
}
