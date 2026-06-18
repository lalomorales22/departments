import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { serverRealtime, sanitizeLoopId, type RunHandle } from '@/lib/server/realtime';

/**
 * POST /api/loops/:id/run — fire ONE real engine cycle for the loop.
 *
 * Phase 3 decouples "run a loop" from "watch a loop": this route spawns the engine
 * subprocess and pipes its NDJSON events INTO the server-side EventStream (re-stamping
 * the authoritative per-loop seq), then returns immediately. Clients receive events by
 * subscribing to `GET /api/loops/:id/stream` (SSE) — so killing/reopening a watcher
 * mid-run loses nothing (resume-by-seq). The subprocess keeps running in the server
 * process, independent of this request.
 *
 *   ?mode=step  — pause before each phase; advance via POST /api/loops/:id/step
 *   ?stall=1    — simulate a stuck loop (demoes the no-progress auto-pause)
 *   ?cycles=N   — run N cycles (default 1)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Next dev runs with cwd = apps/web; the monorepo root is two levels up.
const REPO_ROOT = resolve(process.cwd(), '..', '..');

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loopId = sanitizeLoopId(id);
  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') === 'step' ? 'step' : 'auto';
  const stall = url.searchParams.get('stall') === '1';
  const approvals = url.searchParams.get('approvals') === '1';
  const cycles = clampCycles(url.searchParams.get('cycles'));

  const rt = serverRealtime();
  if (rt.runs.has(loopId)) {
    return Response.json({ started: false, reason: 'already-running', mode }, { status: 409 });
  }

  const args = ['--filter', '@departments/orchestration', 'exec', 'tsx', 'src/cli.ts', loopId, '--stream'];
  if (mode === 'step') args.push('--step');
  if (stall) args.push('--stall');
  if (approvals) args.push('--approvals');
  args.push('--cycles', String(cycles));

  let child;
  try {
    child = spawn('pnpm', args, { cwd: REPO_ROOT, env: process.env });
  } catch (e) {
    await rt.ingest(loopId, errEvent(loopId, `failed to launch engine: ${msg(e)}`, 'SPAWN'));
    return Response.json({ started: false, reason: 'spawn-failed', mode }, { status: 500 });
  }

  const handle: RunHandle = { child, mode, approvals, startedAt: Date.now() };
  rt.runs.set(loopId, handle);

  // Pipe NDJSON stdout → ingest into the shared store (events outlive this request).
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) void rt.ingest(loopId, safeParse(trimmed));
    }
  });
  child.stderr.on('data', (d: Buffer) => console.error('[loop-run]', d.toString()));

  child.on('error', (e) => {
    void rt.ingest(loopId, errEvent(loopId, `engine error: ${e.message}`, 'ENGINE'));
    rt.runs.delete(loopId);
  });
  child.on('close', (code) => {
    if (buffer.trim()) void rt.ingest(loopId, safeParse(buffer.trim()));
    if (code && code !== 0) {
      void rt.ingest(loopId, errEvent(loopId, `engine exited with code ${code}`, 'EXIT'));
    }
    rt.runs.delete(loopId);
  });

  return Response.json({ started: true, mode, cycles });
}

function clampCycles(raw: string | null): number {
  const n = Number(raw ?? '1');
  return Number.isFinite(n) ? Math.min(20, Math.max(1, Math.floor(n))) : 1;
}

function safeParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null; // non-JSON diagnostic line — ignored by ingest
  }
}

function errEvent(loopId: string, message: string, code: string) {
  return {
    id: `run-err-${loopId}-${code}-${Date.now()}`,
    seq: 0,
    loopId,
    ts: new Date().toISOString(),
    kind: 'error',
    payload: { message, code },
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
