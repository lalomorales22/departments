'use client';

import { create } from 'zustand';
import type { DeptEvent } from '@departments/events';
import type { Phase } from '@departments/shared';
import {
  emptyResumeState,
  ingest,
  ReconnectController,
  type ConnectionState,
  type ResumeState,
} from '@departments/realtime';
import { useCockpit } from './store';
import { toast } from './toast';

export type RunStatus = 'idle' | 'running' | 'done' | 'error' | 'paused';
export type RunMode = 'auto' | 'step';

/**
 * The cockpit's realtime store — a single reconnect-safe SSE subscription per loop.
 *
 * It connects to `GET /api/loops/:id/stream`, replays missed events on (re)connect via
 * the resume cursor, dedupes by event id, and tracks connection health. The heavy
 * lifting — resume-by-seq / dedupe / always-settle and the backoff policy — is the
 * unit-tested `@departments/realtime` core; this store wires it to React + `EventSource`
 * and derives `activePhase` / `runStatus` from the event feed. Running a loop
 * (`runLoop`) is fully decoupled from watching it (`connect`), so a watcher can drop
 * and rejoin mid-run with no gaps or duplicate lines.
 */
interface RealtimeState {
  /** Deduped, seq-ordered event log per loop (the LogConsole + derived selectors read this). */
  liveEvents: Record<string, DeptEvent[]>;
  /** Connection lifecycle per loop (drives the StatusBar / live badges). */
  connection: Record<string, ConnectionState>;
  /** Derived run status per loop. */
  runStatus: Record<string, RunStatus>;
  /** Latest engine phase observed per loop (drives the live pipeline). */
  activePhase: Record<string, Phase | undefined>;
  /** Resume cursor per loop (highest applied seq). */
  lastSeq: Record<string, number>;
  /** AUTO vs manual single-STEP run mode per loop. */
  mode: Record<string, RunMode>;

  /** Open (or refresh) the live subscription for a loop. Idempotent. */
  connect: (loopId: string) => void;
  /** Tear down the subscription for a loop. */
  disconnect: (loopId: string) => void;
  /** Fire one real engine run; events arrive over the live subscription. */
  runLoop: (loopId: string, opts?: { mode?: RunMode; stall?: boolean; cycles?: number; approvals?: boolean }) => Promise<void>;
  /** Advance a step-mode run by one phase. */
  step: (loopId: string) => Promise<void>;
  /** Resolve a pending approval (always_ask tool confirmation or child-spawn request). */
  decide: (loopId: string, kind: 'tool' | 'spawn', approve: boolean) => Promise<void>;
  /** Set the run mode (AUTO ↔ STEP) for the NEXT run. */
  setMode: (loopId: string, mode: RunMode) => void;
  /** Reset a loop's local live state (keeps the connection). */
  clear: (loopId: string) => void;
}

// ── Non-reactive per-loop connection internals (kept out of the store) ──────────
interface Conn {
  es: EventSource | null;
  controller: ReconnectController;
  resume: ResumeState;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  staleTimer: ReturnType<typeof setInterval> | null;
}
const conns = new Map<string, Conn>();

const STREAM_URL = (loopId: string, lastSeq: number) =>
  `/api/loops/${encodeURIComponent(loopId)}/stream?lastSeq=${lastSeq}`;

export const useRealtime = create<RealtimeState>((set, get) => {
  /** Push the latest connection state for a loop into the store. */
  const syncConnection = (loopId: string, state: ConnectionState) =>
    set((s) => ({ connection: { ...s.connection, [loopId]: state } }));

  /** Fold one event into the loop's resume state and mirror it into the store. */
  const onEvent = (loopId: string, ev: DeptEvent) => {
    const conn = conns.get(loopId);
    if (!conn) return;
    conn.controller.onActivity();
    const { result } = ingest(conn.resume, ev);
    if (!result.accepted) return;

    set((s) => {
      const next: Partial<RealtimeState> = {
        liveEvents: { ...s.liveEvents, [loopId]: [...conn.resume.events] },
        lastSeq: { ...s.lastSeq, [loopId]: conn.resume.lastSeq },
      };
      // Derive activePhase + runStatus from status/error events.
      if (ev.kind === 'status') {
        const p = ev.payload;
        if (p.phase) next.activePhase = { ...s.activePhase, [loopId]: p.phase };
        if (p.loopStatus) {
          const rs: RunStatus =
            p.loopStatus === 'running'
              ? 'running'
              : p.loopStatus === 'paused'
                ? 'paused'
                : p.loopStatus === 'error'
                  ? 'error'
                  : 'done'; // idle/stopped → cycle ended
          next.runStatus = { ...s.runStatus, [loopId]: rs };
          if (rs === 'done' || rs === 'paused') {
            next.activePhase = { ...s.activePhase, [loopId]: undefined };
          }
        }
      } else if (ev.kind === 'error') {
        next.runStatus = { ...s.runStatus, [loopId]: 'error' };
      }
      return next;
    });
  };

  const open = (loopId: string) => {
    const conn = conns.get(loopId);
    if (!conn || typeof window === 'undefined') return;
    conn.controller.connecting();
    syncConnection(loopId, conn.controller.state);

    const es = new EventSource(STREAM_URL(loopId, conn.resume.lastSeq));
    conn.es = es;

    es.onopen = () => {
      conn.controller.onOpen();
      syncConnection(loopId, 'live');
    };
    es.onmessage = (e) => {
      // The default (unnamed) message channel carries DeptEvents; `open`/heartbeat
      // frames use named events / comments and are ignored here.
      try {
        onEvent(loopId, JSON.parse(e.data) as DeptEvent);
      } catch {
        /* non-JSON keepalive */
      }
    };
    es.onerror = () => {
      es.close();
      conn.es = null;
      const { retry, delayMs } = conn.controller.onError();
      syncConnection(loopId, conn.controller.state);
      if (retry) {
        conn.reconnectTimer = setTimeout(() => open(loopId), delayMs);
      }
    };
  };

  return {
    liveEvents: {},
    connection: {},
    runStatus: {},
    activePhase: {},
    lastSeq: {},
    mode: {},

    connect: (loopId) => {
      let conn = conns.get(loopId);
      if (conn?.es) return; // already connected
      if (!conn) {
        conn = {
          es: null,
          controller: new ReconnectController({ baseMs: 600, maxMs: 12_000, staleAfterMs: 20_000 }),
          // Rebuild the resume state from whatever we already buffered so a re-subscribe
          // keeps the existing log and resumes strictly after the highest seq we hold.
          resume: rebuildResume(get().liveEvents[loopId]),
          reconnectTimer: null,
          staleTimer: null,
        };
        conns.set(loopId, conn);
      }
      // Poll for staleness on a UI cadence.
      if (!conn.staleTimer) {
        conn.staleTimer = setInterval(() => {
          if (conn!.controller.checkStale()) syncConnection(loopId, 'stale');
        }, 5_000);
      }
      open(loopId);
    },

    disconnect: (loopId) => {
      const conn = conns.get(loopId);
      if (!conn) return;
      conn.es?.close();
      conn.controller.stop();
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
      if (conn.staleTimer) clearInterval(conn.staleTimer);
      conns.delete(loopId);
      syncConnection(loopId, 'idle');
    },

    runLoop: async (loopId, opts) => {
      const mode = opts?.mode ?? get().mode[loopId] ?? 'auto';
      // Ensure we're subscribed before the run produces events.
      get().connect(loopId);
      set((s) => ({ runStatus: { ...s.runStatus, [loopId]: 'running' } }));
      const params = new URLSearchParams({ mode, cycles: String(opts?.cycles ?? 1) });
      if (opts?.stall) params.set('stall', '1');
      if (opts?.approvals) params.set('approvals', '1');
      // Forward the user's provider selection so the spawned engine uses the chosen
      // backend (local Ollama / Claude) instead of the deterministic fake runtime.
      const pc = useCockpit.getState().providerConfig;
      try {
        const res = await fetch(`/api/loops/${encodeURIComponent(loopId)}/run?${params}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            provider: pc.provider,
            ollamaModel: pc.ollamaModel,
            ollamaBaseUrl: pc.ollamaBaseUrl,
            ollamaRoleModels: pc.ollamaRoleModels,
            anthropicApiKey: pc.anthropicApiKey,
            claudeModel: pc.claudeModel,
          }),
        });
        if (res.status === 409) {
          toast.info('That loop is already running.');
          set((s) => ({ runStatus: { ...s.runStatus, [loopId]: 'running' } }));
        } else if (!res.ok) {
          throw new Error(`run failed: ${res.status}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'run failed';
        toast.error(`Run failed: ${message}`);
        // Surface the failure locally; the live stream carries server-side errors.
        onEvent(loopId, {
          id: `client-run-err-${loopId}-${Date.now()}`,
          seq: (get().lastSeq[loopId] ?? -1) + 1,
          loopId,
          ts: new Date().toISOString(),
          kind: 'error',
          payload: { message, code: 'CLIENT' },
        });
      }
    },

    step: async (loopId) => {
      try {
        await fetch(`/api/loops/${encodeURIComponent(loopId)}/step`, { method: 'POST' });
      } catch {
        /* a failed step is non-fatal; the engine simply stays paused */
      }
    },

    decide: async (loopId, kind, approve) => {
      try {
        await fetch(`/api/loops/${encodeURIComponent(loopId)}/decide`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, approve }),
        });
      } catch {
        /* a failed decision is non-fatal; the engine stays paused awaiting another */
      }
    },

    setMode: (loopId, mode) => set((s) => ({ mode: { ...s.mode, [loopId]: mode } })),

    clear: (loopId) => {
      const conn = conns.get(loopId);
      if (conn) conn.resume = emptyResumeState();
      set((s) => ({
        liveEvents: { ...s.liveEvents, [loopId]: [] },
        runStatus: { ...s.runStatus, [loopId]: 'idle' },
        activePhase: { ...s.activePhase, [loopId]: undefined },
        lastSeq: { ...s.lastSeq, [loopId]: -1 },
      }));
    },
  };
});

/** Rebuild a resume state from already-buffered events (re-ingest → events+seen+lastSeq). */
function rebuildResume(existing: DeptEvent[] | undefined): ResumeState {
  let state = emptyResumeState();
  if (existing) for (const e of existing) state = ingest(state, e).state;
  return state;
}
