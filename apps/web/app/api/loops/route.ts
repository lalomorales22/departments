/**
 * /api/loops — the loop registry (real, SQLite-backed; no fixtures).
 *
 *   GET  → list every loop in the local workspace (with live last-run state).
 *   POST → create a loop ({ name, mission?, level?, parentLoopId?, cadence?, budgetCapUsd? }).
 */
import { createLoop, getLoopRow, listLoops } from '@/lib/server/db';
import { LOCAL_ORG_ID, displayNameFromSlug, slugifyLoopName } from '@/lib/workspace';
import type { LoopLevel } from '@departments/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ loops: listLoops(LOCAL_ORG_ID) });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const rawName = typeof body.name === 'string' ? body.name : '';
  const slug = slugifyLoopName(rawName);
  if (!slug) return Response.json({ error: 'a loop name is required' }, { status: 400 });

  // Ensure a unique id; a second `loop marketing` becomes `loop-marketing-2`.
  const baseId = `loop-${slug}`;
  let id = baseId;
  for (let n = 2; getLoopRow(id); n += 1) id = `${baseId}-${n}`;

  const level = clampLevel(body.level);
  const now = new Date().toISOString();
  const loop = createLoop({
    id,
    orgId: LOCAL_ORG_ID,
    name: slug,
    displayName: typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : displayNameFromSlug(slug),
    mission: typeof body.mission === 'string' && body.mission.trim() ? body.mission.trim() : `Run the ${slug} department and improve every cycle.`,
    level,
    parentLoopId: typeof body.parentLoopId === 'string' ? body.parentLoopId : null,
    cadence: typeof body.cadence === 'string' ? body.cadence : 'manual',
    budgetCapUsd: typeof body.budgetCapUsd === 'number' ? body.budgetCapUsd : 100,
    now,
  });
  return Response.json({ loop }, { status: 201 });
}

function clampLevel(v: unknown): LoopLevel {
  const n = typeof v === 'number' ? Math.round(v) : 3;
  return (n >= 1 && n <= 4 ? n : 3) as LoopLevel;
}
