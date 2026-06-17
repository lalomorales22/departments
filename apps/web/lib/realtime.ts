'use client';

import { create } from 'zustand';
import type { DeptEvent } from '@departments/events';

export type RunStatus = 'idle' | 'running' | 'done' | 'error';

interface RealtimeState {
  /** Live events streamed from a real engine run, keyed by loopId. */
  liveEvents: Record<string, DeptEvent[]>;
  runStatus: Record<string, RunStatus>;
  /** Latest engine phase observed for a loop (drives a live pipeline overlay). */
  activePhase: Record<string, string | undefined>;
  /** Kick off a real loop cycle; streams NDJSON DeptEvents from the engine CLI. */
  runLoop: (loopId: string) => Promise<void>;
  clear: (loopId: string) => void;
}

export const useRealtime = create<RealtimeState>((set, get) => ({
  liveEvents: {},
  runStatus: {},
  activePhase: {},

  clear: (loopId) =>
    set((s) => ({
      liveEvents: { ...s.liveEvents, [loopId]: [] },
      runStatus: { ...s.runStatus, [loopId]: 'idle' },
      activePhase: { ...s.activePhase, [loopId]: undefined },
    })),

  runLoop: async (loopId) => {
    if (get().runStatus[loopId] === 'running') return;
    set((s) => ({
      liveEvents: { ...s.liveEvents, [loopId]: [] },
      runStatus: { ...s.runStatus, [loopId]: 'running' },
      activePhase: { ...s.activePhase, [loopId]: undefined },
    }));

    const append = (ev: DeptEvent) =>
      set((s) => {
        const prev = s.liveEvents[loopId] ?? [];
        const phase =
          ev.kind === 'status' && ev.payload.phase ? ev.payload.phase : s.activePhase[loopId];
        return {
          liveEvents: { ...s.liveEvents, [loopId]: [...prev, ev] },
          activePhase: { ...s.activePhase, [loopId]: phase },
        };
      });

    try {
      const res = await fetch(`/api/loops/${encodeURIComponent(loopId)}/run`, { method: 'POST' });
      if (!res.ok || !res.body) throw new Error(`run failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            append(JSON.parse(trimmed) as DeptEvent);
          } catch {
            // ignore non-JSON keepalive/diagnostic lines
          }
        }
      }
      set((s) => ({ runStatus: { ...s.runStatus, [loopId]: 'done' } }));
    } catch (err) {
      append({
        id: `client-err-${loopId}`,
        seq: 1e9,
        loopId,
        ts: new Date().toISOString(),
        kind: 'error',
        payload: { message: err instanceof Error ? err.message : 'run stream failed', code: 'CLIENT' },
      });
      set((s) => ({ runStatus: { ...s.runStatus, [loopId]: 'error' } }));
    }
  },
}));
