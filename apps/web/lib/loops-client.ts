'use client';

/**
 * The client-side loop registry — the cockpit's reactive mirror of the real, SQLite-backed
 * loops served by `/api/loops`. This REPLACES the Phase-1 `fixtures/loops.ts` constants:
 * the tree, header, inspector, command bar, analytics, and settings all read from here, so
 * the cockpit shows the loops you actually create, not demo data.
 *
 * Status/health/cycle on each row reflect the last persisted run state; `hydrate()` after a
 * run completes refreshes them. Live, in-flight phase/status for the ACTIVE loop still comes
 * from the realtime SSE overlay in `lib/live.ts`.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { Loop, LoopTreeNode } from '@departments/shared';

interface CreateLoopInput {
  name: string;
  mission?: string;
  level?: number;
  parentLoopId?: string | null;
  cadence?: string;
  budgetCapUsd?: number;
}

interface LoopRegistry {
  loops: Loop[];
  loaded: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  create: (input: CreateLoopInput) => Promise<Loop | null>;
  remove: (id: string) => Promise<void>;
}

export const useLoopRegistry = create<LoopRegistry>((set, get) => ({
  loops: [],
  loaded: false,
  error: null,

  hydrate: async () => {
    try {
      const res = await fetch('/api/loops', { cache: 'no-store' });
      const data = (await res.json()) as { loops: Loop[] };
      set({ loops: data.loops ?? [], loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : 'failed to load loops' });
    }
  },

  create: async (input) => {
    try {
      const res = await fetch('/api/loops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const { loop } = (await res.json()) as { loop: Loop };
      set((s) => ({ loops: [...s.loops.filter((l) => l.id !== loop.id), loop] }));
      return loop;
    } catch {
      return null;
    }
  },

  remove: async (id) => {
    set((s) => ({ loops: s.loops.filter((l) => l.id !== id) }));
    try {
      await fetch(`/api/loops/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      void get().hydrate(); // re-sync if the delete failed
    }
  },
}));

// ── Selectors ────────────────────────────────────────────────────────────────

export function useLoops(): Loop[] {
  return useLoopRegistry((s) => s.loops);
}

export function useLoopById(id: string): Loop | undefined {
  return useLoopRegistry((s) => s.loops.find((l) => l.id === id));
}

export function useLoopsLoaded(): boolean {
  return useLoopRegistry((s) => s.loaded);
}

/** Build the nested forest from the flat registry (mirrors the old fixture buildLoopTree). */
export function buildTree(loops: Loop[]): LoopTreeNode[] {
  const byParent = new Map<string | null, Loop[]>();
  for (const loop of loops) {
    const arr = byParent.get(loop.parentLoopId) ?? [];
    arr.push(loop);
    byParent.set(loop.parentLoopId, arr);
  }
  const build = (loop: Loop): LoopTreeNode => ({ loop, children: (byParent.get(loop.id) ?? []).map(build) });
  // Roots = loops whose parent isn't present in the set (covers orphaned parents too).
  const ids = new Set(loops.map((l) => l.id));
  return loops.filter((l) => l.parentLoopId === null || !ids.has(l.parentLoopId)).map(build);
}

export function useLoopTree(): LoopTreeNode[] {
  const loops = useLoops();
  return useMemo(() => buildTree(loops), [loops]);
}
