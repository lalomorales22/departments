/**
 * Server-side realtime singleton — the local cockpit's slice of the Phase 3 spine.
 *
 * The engine runs as a subprocess (per `/api/loops/:id/run`) and emits NDJSON
 * DeptEvents. Those events must outlive the request that started the run so a client
 * can reconnect and resume, so they land in a process-global {@link EventStream}
 * (in-memory here; Redis when `REDIS_URL` + an injected client are configured). The
 * SSE route subscribes to the SAME store, decoupling "run a loop" from "watch a loop"
 * — the reconnect-safety win.
 *
 * This module is SERVER-ONLY (imported solely by route handlers, Node runtime). It is
 * stashed on `globalThis` so Next's per-route module graphs share one instance.
 *
 * Authoritative seq: the engine's per-process seq is PROVISIONAL (it resets each run).
 * The server re-stamps a monotonic per-loop seq on ingest — seeded from the store's
 * `lastSeq` — so `(loopId, seq)` stays monotonic ACROSS runs, which is what
 * resume-by-seq depends on. The stable event `id` carries the dedupe identity through
 * the re-stamp untouched.
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createEventStream, type EventStream } from '@departments/realtime';
import type { DeptEvent } from '@departments/events';
import { EVENT_KINDS } from '@departments/shared';

export interface RunHandle {
  child: ChildProcessWithoutNullStreams;
  mode: 'auto' | 'step';
  /** Started with interactive Commander approvals (always_ask + child-spawn over stdin). */
  approvals?: boolean;
  startedAt: number;
}

export interface ServerRealtime {
  readonly stream: EventStream;
  /** Re-stamp the authoritative per-loop seq and append. Returns the stored event. */
  ingest(loopId: string, raw: unknown): Promise<DeptEvent | null>;
  /** Allocate the next authoritative seq for a loop (seeded lazily from the store). */
  nextSeq(loopId: string): Promise<number>;
  /** Loops with a live engine subprocess (for `/step` + lifecycle). */
  readonly runs: Map<string, RunHandle>;
}

const KINDS = new Set<string>(EVENT_KINDS);

function createServerRealtime(): ServerRealtime {
  // No Redis on this machine → in-memory. The Redis client (when present) is injected
  // at construction; we keep this package free of any driver import.
  const stream = createEventStream({ redisUrl: process.env.REDIS_URL });
  const seqs = new Map<string, number>();
  const runs = new Map<string, RunHandle>();

  async function nextSeq(loopId: string): Promise<number> {
    let n = seqs.get(loopId);
    if (n === undefined) n = (await stream.lastSeq(loopId)) + 1;
    seqs.set(loopId, n + 1);
    return n;
  }

  async function ingest(loopId: string, raw: unknown): Promise<DeptEvent | null> {
    if (raw === null || typeof raw !== 'object') return null;
    const ev = raw as Partial<DeptEvent>;
    if (typeof ev.id !== 'string' || typeof ev.kind !== 'string' || !KINDS.has(ev.kind)) return null;
    const seq = await nextSeq(loopId);
    const stamped = { ...(ev as DeptEvent), loopId, seq };
    await stream.append(loopId, stamped);
    // Structured trace line keyed by org/loop/run/seq (opt-in; off by default).
    if (process.env.DEPT_TRACE) {
      console.log(
        JSON.stringify({ t: 'event', org: 'org-local', loop: loopId, run: stamped.runId ?? null, seq, kind: stamped.kind }),
      );
    }
    return stamped;
  }

  return { stream, ingest, nextSeq, runs };
}

const g = globalThis as typeof globalThis & { __departmentsRealtime__?: ServerRealtime };

/** The shared server realtime instance (created once per server process). */
export function serverRealtime(): ServerRealtime {
  return (g.__departmentsRealtime__ ??= createServerRealtime());
}

/** Sanitize an incoming loop id identically everywhere (run + stream + step routes). */
export function sanitizeLoopId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}
