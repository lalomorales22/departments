import { serverRealtime, sanitizeLoopId } from '@/lib/server/realtime';
import type { DeptEvent } from '@departments/events';

/**
 * GET /api/loops/:id/stream — the reconnect-safe realtime feed (Server-Sent Events).
 *
 * On connect it REPLAYS every event after the resume cursor, then tails the live
 * stream. The cursor comes from `?lastSeq=N` or the SSE `Last-Event-ID` header (set
 * automatically by the browser's EventSource on reconnect), and each frame's `id:` is
 * the event's `seq` — so a dropped connection resumes with zero gaps and zero
 * duplicates (the server only sends `seq > cursor`; the client also dedupes by event
 * id as a belt-and-braces guard). A periodic heartbeat comment keeps the pipe warm and
 * lets the client detect staleness.
 *
 * SSE (not raw WS) is the browser transport for the LOCAL cockpit: it runs under
 * `next dev` with no extra server, and natively reconnects with `Last-Event-ID`. The
 * NestJS WS gateway is the production transport over the SAME `EventStream` spine.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loopId = sanitizeLoopId(id);
  const rt = serverRealtime();

  // Resume cursor: the SSE `Last-Event-ID` header (set by the browser on a native
  // auto-reconnect) is authoritative; else an explicit `?lastSeq` (manual reconnect);
  // else from the start. Header-first means BOTH reconnection paths resume cleanly.
  const url = new URL(req.url);
  const headerRaw = req.headers.get('last-event-id');
  const queryRaw = url.searchParams.get('lastSeq');
  const fromHeader = headerRaw !== null ? Number(headerRaw) : Number.NaN;
  const fromQuery = queryRaw !== null ? Number(queryRaw) : Number.NaN;
  const cursor = Number.isFinite(fromHeader)
    ? fromHeader
    : Number.isFinite(fromQuery)
      ? fromQuery
      : -1;

  const enc = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s));
      };
      const frame = (e: DeptEvent) =>
        // DeptEvents ride the DEFAULT (unnamed) SSE channel so the browser delivers them
        // to `EventSource.onmessage` — the client's single handler. Naming them
        // (`event: <kind>`) would route them to per-kind `addEventListener` listeners the
        // client doesn't register, so they'd silently never arrive. `id:` = seq still
        // drives Last-Event-ID resume; the kind already rides inside the JSON payload.
        safeEnqueue(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);

      // Open: tell the client where the cursor landed, then subscribe (which first
      // drains the backlog after `cursor`, then tails live) — exactly-once per seq.
      safeEnqueue(`event: open\ndata: ${JSON.stringify({ loopId, cursor })}\n\n`);
      unsubscribe = rt.stream.subscribe(loopId, cursor, frame);

      heartbeat = setInterval(() => safeEnqueue(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
