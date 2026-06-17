/**
 * resume.ts — the PURE reconnect-safety core.
 *
 * This module owns the two invariants frozen in `@departments/events`:
 *   - `seq` is MONOTONIC PER LOOP — the resume cursor is `(loopId, seq)`.
 *   - `id` is STABLE per logical event — the dedupe key across reconnects/replays.
 *   - Terminal/status events (`status|metric|error`) MUST always settle on resume
 *     even if their `id` was already seen.
 *
 * It is transport-agnostic and side-effect free, so the SAME logic backs the browser
 * realtime store (SSE today, WS later) and the server-side WS gateway. Everything
 * here is exhaustively unit-tested — it is the piece that must not be wrong.
 */
import type { DeptEvent } from '@departments/events';
import { isAlwaysSettle } from '@departments/events';

// ─── Bounded seen-set (dedupe key store with insertion-order eviction) ──────────

/**
 * A Set that keeps at most `cap` ids, evicting the oldest on overflow. The dedupe
 * window only needs to span a reconnect's worth of replay, so a bounded set keeps
 * a long-lived session from leaking memory while preserving correctness in practice.
 */
export class BoundedSet {
  private readonly order: string[] = [];
  private readonly set = new Set<string>();

  constructor(private readonly cap = 10_000) {}

  has(id: string): boolean {
    return this.set.has(id);
  }

  add(id: string): void {
    if (this.set.has(id)) return;
    this.set.add(id);
    this.order.push(id);
    if (this.order.length > this.cap) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.set.delete(evicted);
    }
  }

  get size(): number {
    return this.set.size;
  }
}

// ─── Resume state + ingest ──────────────────────────────────────────────────────

export interface ResumeState {
  /** Events in ascending `seq` order, deduped by `id`. */
  readonly events: DeptEvent[];
  /** Highest `seq` ever applied — the cursor sent on resume (`?lastSeq=`). */
  readonly lastSeq: number;
  /** Dedupe window keyed on stable event `id`. */
  readonly seen: BoundedSet;
}

export interface IngestResult {
  /** True when the event changed state (a new line, or an always-settle re-affirm). */
  readonly accepted: boolean;
  /** True when the event was a brand-new logical event (appended to `events`). */
  readonly appended: boolean;
}

/** A fresh resume state. `lastSeq` starts at -1 so the first event (seq 0) advances it. */
export function emptyResumeState(seenCap?: number): ResumeState {
  return { events: [], lastSeq: -1, seen: new BoundedSet(seenCap) };
}

/**
 * Fold one event into the resume state, IN PLACE (the `events`/`seen` containers are
 * mutated; `lastSeq` is returned via the new state object). Returns whether it was
 * accepted/appended so callers can decide whether to notify subscribers.
 *
 * Rules (the frozen contract):
 *  - New `id`            → append in `seq` order, remember the id, advance `lastSeq`.
 *  - Seen `id`, settle   → re-affirm: advance `lastSeq`, but DO NOT append a duplicate
 *                          line (the derived fold already reflects it). `accepted=true`.
 *  - Seen `id`, non-settle → reject entirely (a pure duplicate log/output line).
 */
export function ingest(state: ResumeState, e: DeptEvent): { state: ResumeState; result: IngestResult } {
  const isDup = state.seen.has(e.id);

  if (isDup) {
    if (isAlwaysSettle(e)) {
      // Settle terminal/status state again, but never a duplicate visible line.
      const lastSeq = Math.max(state.lastSeq, e.seq);
      return { state: { ...state, lastSeq }, result: { accepted: true, appended: false } };
    }
    return { state, result: { accepted: false, appended: false } };
  }

  // New logical event — insert maintaining ascending seq order (push-fast-path, then
  // a single back-shift for the rare out-of-order arrival during overlapping replay).
  insertBySeq(state.events, e);
  state.seen.add(e.id);
  const lastSeq = Math.max(state.lastSeq, e.seq);
  return { state: { ...state, lastSeq }, result: { accepted: true, appended: true } };
}

/** Insert `e` into an ascending-by-seq array, mutating it. O(1) for in-order arrival. */
function insertBySeq(events: DeptEvent[], e: DeptEvent): void {
  const last = events[events.length - 1];
  if (last === undefined || last.seq <= e.seq) {
    events.push(e);
    return;
  }
  // Out of order: find the first index whose seq exceeds e.seq and splice before it.
  let i = events.length - 1;
  while (i >= 0 && (events[i] as DeptEvent).seq > e.seq) i -= 1;
  events.splice(i + 1, 0, e);
}

/**
 * The cursor a client/gateway sends to resume: replay strictly AFTER `lastSeq`.
 * Mirrors `ResumeCursor` from `@departments/events` (re-exported for ergonomics).
 */
export function resumeQuery(lastSeq: number): number {
  return Number.isFinite(lastSeq) && lastSeq >= 0 ? lastSeq : -1;
}
