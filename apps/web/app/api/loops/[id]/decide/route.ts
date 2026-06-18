import { serverRealtime, sanitizeLoopId } from '@/lib/server/realtime';

/**
 * POST /api/loops/:id/decide — the Commander's verdict on a pending approval.
 *
 * An `--approvals` run pauses on an irreversible tool (always_ask) or a child-spawn
 * request, awaiting a decision on its stdin. This route writes that decision line to the
 * live subprocess — the same mechanism as /step — releasing the gate. Body:
 *   { kind: 'tool' | 'spawn', approve: boolean }
 * Returns 409 if there is no approvals-mode run for the loop.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loopId = sanitizeLoopId(id);
  const handle = serverRealtime().runs.get(loopId);

  if (!handle) return Response.json({ decided: false, reason: 'no-active-run' }, { status: 409 });
  if (!handle.approvals) return Response.json({ decided: false, reason: 'not-approvals-mode' }, { status: 409 });

  let body: { kind?: unknown; approve?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ decided: false, reason: 'invalid-json' }, { status: 400 });
  }
  const kind = body.kind === 'spawn' ? 'spawn' : body.kind === 'tool' ? 'tool' : null;
  if (!kind) return Response.json({ decided: false, reason: 'bad-kind' }, { status: 400 });
  const verb = body.approve ? 'allow' : 'deny';

  try {
    handle.child.stdin.write(`${kind}:${verb}\n`);
  } catch (e) {
    return Response.json(
      { decided: false, reason: e instanceof Error ? e.message : 'write-failed' },
      { status: 500 },
    );
  }
  return Response.json({ decided: true, kind, approve: body.approve === true });
}
