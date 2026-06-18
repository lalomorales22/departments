'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DeptEvent } from '@departments/events';
import type { Agent, AgentRole, ArtifactKind, Metric, Phase, PipelineState } from '@departments/shared';
import { uiLabelForPhase } from '@departments/shared';
import type { ConnectionState } from '@departments/realtime';
import { useRealtime, type RunStatus } from './realtime';
import {
  getAgents,
  getMetrics,
  getPipelineState,
  getLoop,
} from './fixtures';

/**
 * Live-or-fixture hooks: each cockpit organism reads through one of these. When a real
 * loop has streamed events, the hook returns LIVE state derived from the event feed;
 * otherwise it returns the Phase-1 fixture so the cockpit is never empty. This is the
 * single place "fixtures → live" is decided, generalizing the merge LogConsole already
 * does for the log stream.
 */

export function useConnection(loopId: string): ConnectionState {
  return useRealtime((s) => s.connection[loopId] ?? 'idle');
}

export function useRunStatus(loopId: string): RunStatus {
  return useRealtime((s) => s.runStatus[loopId] ?? 'idle');
}

export function useRunMode(loopId: string) {
  return useRealtime((s) => s.mode[loopId] ?? 'auto');
}

/** True once any real event has streamed for this loop. */
export function useHasLive(loopId: string): boolean {
  return useRealtime((s) => (s.liveEvents[loopId]?.length ?? 0) > 0);
}

// ── Pipeline ────────────────────────────────────────────────────────────────────

const PHASE_ORDER: Phase[] = ['plan', 'execute', 'evaluate', 'improve', 'memory'];

/** Extract the cycle number from an engine runId like `run-<loop>-c12`. */
function cycleOf(runId: string | undefined): number | null {
  const m = runId?.match(/-c(\d+)$/);
  return m ? Number(m[1]) : null;
}

export function useLivePipeline(loopId: string): PipelineState {
  const events = useRealtime((s) => s.liveEvents[loopId]);
  const activePhase = useRealtime((s) => s.activePhase[loopId]);
  const runStatus = useRealtime((s) => s.runStatus[loopId] ?? 'idle');

  return useMemo(() => {
    if (!events || events.length === 0) return getPipelineState(loopId);

    let maxCycle = 0;
    for (const e of events) {
      const c = cycleOf(e.runId);
      if (c !== null && c > maxCycle) maxCycle = c;
    }

    const stageStatus: PipelineState['stageStatus'] = {};
    const activeIdx = activePhase ? PHASE_ORDER.indexOf(activePhase) : -1;
    PHASE_ORDER.forEach((p, i) => {
      if (activeIdx >= 0) {
        stageStatus[p] = i < activeIdx ? 'complete' : i === activeIdx ? 'active' : 'pending';
      } else if (runStatus === 'done') {
        stageStatus[p] = 'complete'; // cycle finished cleanly
      } else if (runStatus === 'paused' || runStatus === 'error') {
        stageStatus[p] = 'error';
      } else {
        stageStatus[p] = 'pending';
      }
    });

    return {
      activePhase: activePhase ?? null,
      stageStatus,
      cycleCount: maxCycle || (getLoop(loopId)?.cycleCount ?? 0),
      elapsedSeconds: elapsedFrom(events),
    };
  }, [events, activePhase, runStatus, loopId]);
}

function elapsedFrom(events: DeptEvent[]): number {
  const first = events[0];
  if (!first) return 0;
  const start = new Date(first.ts).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

// ── Agents ────────────────────────────────────────────────────────────────────

/** The engine runs one role per phase; map the active phase to the role(s) it drives. */
const PHASE_ROLE: Record<Phase, AgentRole | null> = {
  bootstrap: null,
  plan: 'planner',
  execute: 'executor',
  evaluate: 'reviewer',
  improve: 'reviewer',
  memory: 'docs',
};

export function useLiveAgents(loopId: string): Agent[] {
  const activePhase = useRealtime((s) => s.activePhase[loopId]);
  const runStatus = useRealtime((s) => s.runStatus[loopId] ?? 'idle');
  const hasLive = useHasLive(loopId);

  return useMemo(() => {
    const roster = getAgents(loopId);
    if (!hasLive) return roster;

    const activeRole = activePhase ? PHASE_ROLE[activePhase] : null;
    const running = runStatus === 'running' && activeRole !== null;
    return roster.map((a) => ({
      ...a,
      status: running && a.role === activeRole ? 'running' : 'idle',
      activity:
        running && a.role === activeRole
          ? `Working the ${activePhase?.toUpperCase()} phase`
          : a.status === 'running'
            ? 'Standing by'
            : a.activity,
    }));
  }, [loopId, activePhase, runStatus, hasLive]);
}

// ── Metrics ──────────────────────────────────────────────────────────────────

const LIVE_METRIC_ORDER = ['health', 'throughput', 'cost_usd', 'cache_read_input_tokens', 'tokens'];

/** Fold metric events into per-key view-models (latest value + a sparkline series). */
function deriveLiveMetrics(loopId: string, events: DeptEvent[]): Metric[] {
  const byKey = new Map<string, DeptEvent[]>();
  for (const e of events) {
    if (e.kind !== 'metric') continue;
    const arr = byKey.get(e.payload.key) ?? [];
    arr.push(e);
    byKey.set(e.payload.key, arr);
  }
  const out: Metric[] = [];
  for (const key of LIVE_METRIC_ORDER) {
    const series = byKey.get(key);
    if (!series || series.length === 0) continue;
    const last = series[series.length - 1];
    if (last?.kind !== 'metric') continue;
    const p = last.payload;
    out.push({
      id: `live-${loopId}-${key}`,
      orgId: 'org-local',
      loopId,
      key,
      name: p.name,
      value: p.value,
      display: p.display,
      delta: p.delta,
      goodDirection: p.goodDirection,
      unit: p.unit,
      series: series.slice(-24).map((e) => (e.kind === 'metric' ? e.payload.value : 0)),
      ts: last.ts,
    });
  }
  return out;
}

export function useLiveMetrics(loopId: string): { metrics: Metric[]; live: boolean } {
  const events = useRealtime((s) => s.liveEvents[loopId]);
  return useMemo(() => {
    const fixtures = getMetrics(loopId);
    const live = events ? deriveLiveMetrics(loopId, events) : [];
    if (live.length === 0) return { metrics: fixtures, live: false };
    // Live engine metrics lead; the domain fixture cards follow for context.
    return { metrics: [...live, ...fixtures], live: true };
  }, [loopId, events]);
}

// ── Per-run trace (observability: phase timeline + grader + guardrail, from events) ──

export interface TraceEntry {
  id: string;
  phase: Phase;
  stamp: string;
  title: string;
  sub: string;
}

/**
 * Derive a per-run trace from the live event feed: phase transitions, grader outcomes,
 * and guardrail (budget / no-progress) events — newest first. Returns null when no real
 * run has streamed (the Inspector then shows the synthesized fixture timeline). This is
 * the observability surface keyed by run/phase/seq the Phase 3 plan calls for.
 */
export function useRunTrace(loopId: string): TraceEntry[] | null {
  const events = useRealtime((s) => s.liveEvents[loopId]);
  return useMemo(() => {
    if (!events || events.length === 0) return null;
    const entries: TraceEntry[] = [];
    let lastPhase: Phase | null = null;
    for (const e of events) {
      if (e.kind === 'status' && e.payload.phase && e.payload.phase !== 'bootstrap' && e.payload.phase !== lastPhase) {
        const ph: Exclude<Phase, 'bootstrap'> = e.payload.phase;
        const cyc = cycleOf(e.runId) ?? 0;
        const label = uiLabelForPhase(ph);
        entries.push({
          id: `tr-${e.id}`,
          phase: ph,
          stamp: `CYCLE ${cyc} · ${label}`,
          title: `${label} phase`,
          sub: e.runId ?? '',
        });
        lastPhase = ph;
      } else if (e.kind === 'log' && e.payload.source === 'grader' && e.payload.message.startsWith('outcome:')) {
        entries.push({ id: `tr-${e.id}`, phase: 'evaluate', stamp: 'GRADER', title: e.payload.message, sub: `seq ${e.seq}` });
      } else if (e.kind === 'log' && e.payload.source === 'objective') {
        // A CEO set_objective steer (frozen protocol: a `log` with source 'objective')
        // — surfaced in the child's HISTORY against the PLAN phase it feeds.
        entries.push({ id: `tr-${e.id}`, phase: 'plan', stamp: 'OBJECTIVE', title: e.payload.message, sub: 'from CEO meta-loop' });
      } else if (e.kind === 'log' && e.payload.source === 'ceo') {
        entries.push({ id: `tr-${e.id}`, phase: 'improve', stamp: 'CEO', title: e.payload.message, sub: `seq ${e.seq}` });
      } else if (e.kind === 'log' && e.payload.source === 'guardrail') {
        entries.push({ id: `tr-${e.id}`, phase: 'memory', stamp: 'GUARDRAIL', title: e.payload.message, sub: `seq ${e.seq}` });
      } else if (e.kind === 'error') {
        entries.push({ id: `tr-${e.id}`, phase: 'evaluate', stamp: 'ERROR', title: e.payload.message, sub: e.payload.code ?? '' });
      }
    }
    return entries.reverse();
  }, [events]);
}

// ── Inspector (real artifacts + memory + handoff from the loop's git workspace) ──

export interface LoopInspect {
  exists: boolean;
  version: string;
  artifacts: Array<{ path: string; kind: ArtifactKind; sizeBytes: number; version: string }>;
  memory: Array<{ path: string; summary: string }>;
  handoff: string | null;
}

/**
 * Fetch the loop's real inspector payload from `/api/loops/:id/inspect`. Refetches when
 * the loop changes or a run completes (so artifacts/memory reflect the latest cycle).
 * Returns `null` until loaded, or `{ exists:false }` when the loop has never run locally.
 */
export function useLoopInspect(loopId: string, reloadKey = 0): LoopInspect | null {
  const runStatus = useRunStatus(loopId);
  const [data, setData] = useState<LoopInspect | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/loops/${encodeURIComponent(loopId)}/inspect`)
      .then((r) => (r.ok ? (r.json() as Promise<LoopInspect>) : null))
      .then((d) => {
        if (!cancelled && d) setData(d);
      })
      .catch(() => {
        /* inspector falls back to fixtures on fetch failure */
      });
    return () => {
      cancelled = true;
    };
    // Refetch on loop switch, when a run finishes/pauses (new artifacts on disk), and
    // when `reloadKey` bumps (e.g. after a ⌘I import).
  }, [loopId, runStatus, reloadKey]);
  return data;
}

// ── Pending approvals (always_ask tool confirmation + child-spawn request) ──────

export interface PendingApprovals {
  /** An irreversible tool awaiting Commander confirmation, or null. */
  tool: { tool: string; summary: string } | null;
  /** A child-spawn request awaiting approval, or null. */
  spawn: { message: string } | null;
}

/**
 * Derive the loop's UNRESOLVED approvals from the live feed (frozen protocol — no new
 * event kinds): an `always_ask` is a `tool_use` start that no later result/error has
 * settled; a child-spawn is a `log` (source 'spawn') "awaiting…" that no later approved/
 * denied outcome has settled. The cockpit's ApprovalBanner renders these and POSTs the
 * Commander's verdict to /decide.
 */
export function usePendingApprovals(loopId: string): PendingApprovals {
  const events = useRealtime((s) => s.liveEvents[loopId]);
  return useMemo(() => {
    let tool: PendingApprovals['tool'] = null;
    let spawn: PendingApprovals['spawn'] = null;
    if (events) {
      for (const e of events) {
        if (e.kind === 'tool_use') {
          const p = e.payload;
          if (p.phase === 'start' && p.summary.startsWith('always_ask')) {
            tool = { tool: p.tool, summary: p.summary.replace(/^always_ask · /, '') };
          } else if (p.phase === 'result' || p.phase === 'error') {
            tool = null; // settled (approved/denied)
          }
        } else if (e.kind === 'log' && e.payload.source === 'spawn') {
          spawn = /awaiting/i.test(e.payload.message) ? { message: e.payload.message } : null;
        }
      }
    }
    return { tool, spawn };
  }, [events]);
}

/** Loop health (0–100): the live `health` metric if present, else the fixture value. */
export function useLiveHealth(loopId: string): { health: number; live: boolean } {
  const events = useRealtime((s) => s.liveEvents[loopId]);
  return useMemo(() => {
    let latest: number | null = null;
    if (events) {
      for (const e of events) {
        if (e.kind === 'metric' && e.payload.key === 'health') latest = e.payload.value;
      }
    }
    if (latest !== null) return { health: latest, live: true };
    return { health: getLoop(loopId)?.health ?? 0, live: false };
  }, [loopId, events]);
}
