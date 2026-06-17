import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * POST /api/loops/:id/run — run ONE real engine cycle for the loop and stream its
 * events back as NDJSON (one DeptEvent JSON per line). We spawn the orchestration
 * CLI as a subprocess (rather than importing the Node-only engine into the webpack
 * bundle), so the cockpit is driven by the actual `@departments/orchestration` engine
 * + FakeCmaRuntime + real git artifacts. This is the Phase 2 "minimal run-a-loop"
 * trigger; the reconnect-safe WS spine arrives in Phase 3.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Next dev runs with cwd = apps/web; the monorepo root is two levels up.
const REPO_ROOT = resolve(process.cwd(), '..', '..');

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loopId = id.replace(/[^a-zA-Z0-9_-]/g, '');

  // Hoisted so cancel() can kill the subprocess on client abort.
  let child: ChildProcessWithoutNullStreams | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const errEvent = (message: string, code: string) =>
        enc.encode(
          JSON.stringify({
            id: `run-err-${loopId}-${code}`,
            seq: 0,
            loopId,
            ts: new Date().toISOString(),
            kind: 'error',
            payload: { message, code },
          }) + '\n',
        );
      const safeEnqueue = (chunk: Uint8Array) => {
        if (!closed) controller.enqueue(chunk);
      };
      const finish = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      child = spawn(
        'pnpm',
        ['--filter', '@departments/orchestration', 'exec', 'tsx', 'src/cli.ts', loopId, '--stream'],
        { cwd: REPO_ROOT, env: process.env },
      );
      child.stdout.on('data', (d: Buffer) => safeEnqueue(new Uint8Array(d)));
      child.stderr.on('data', (d: Buffer) => console.error('[loop-run]', d.toString()));
      child.on('error', (e) => {
        safeEnqueue(errEvent(`failed to launch engine: ${e.message}`, 'SPAWN'));
        finish();
      });
      child.on('close', (code) => {
        // Surface a non-zero exit as a terminal error event (the engine's stack went to
        // stderr, server-side only) so the client sees the failure instead of a silent end.
        if (code && code !== 0) safeEnqueue(errEvent(`engine exited with code ${code}`, 'EXIT'));
        finish();
      });
    },
    // Client aborted (tab close, navigation, unmount mid-run) → kill the subprocess so
    // it doesn't keep running detached.
    cancel() {
      closed = true;
      child?.kill();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
