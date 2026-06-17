/**
 * The engine's PORTS (hexagonal boundary). The engine depends ONLY on these
 * interfaces; concrete adapters (git artifacts, pgvector memory, the rubric library,
 * the budget ledger, Postgres persistence) are wired at the composition root
 * (`local-driver`, the Temporal activities). This keeps the cycle logic pure and
 * fully unit-testable with in-memory fakes.
 */
import type { DeptEvent } from '@departments/events';
import type { Phase, RubricCategory, TokenUsage } from '@departments/shared';

// ── Artifacts (files-as-memory in a per-loop git repo) ────────────────────────

export interface ArtifactSnapshot {
  /** Git SHA of the commit (or a synthetic id for in-memory fakes). */
  sha: string;
  /** Human version label, e.g. "v12". */
  version: string;
  /** Paths changed by this snapshot, relative to the workspace. */
  changedFiles: string[];
  /**
   * Whether the change is MEANINGFUL — real source/content/decision change, not the
   * always-rewritten HANDOFF.md or timestamp churn. Feeds the no-progress detector.
   */
  meaningful: boolean;
}

export interface ArtifactPort {
  /** Ensure a git working tree exists for the loop; returns its absolute path. */
  provision(loopId: string): Promise<{ workspaceDir: string }>;
  /** Seed README/TASKS/HANDOFF on cold start (only writes missing files). */
  seedIfEmpty(loopId: string, seeds: Record<string, string>): Promise<void>;
  /** Read an artifact's text, or null if absent. */
  read(loopId: string, rel: string): Promise<string | null>;
  /** Commit the current working tree, tag it `loopId:runId:phase`, return the snapshot. */
  snapshot(loopId: string, meta: { runId: string; phase: Phase; message: string }): Promise<ArtifactSnapshot>;
}

// ── Memory (cross-cycle searchable recall) ────────────────────────────────────

export interface MemoryHit {
  path: string;
  summary: string;
  /** 0–1 relevance to the query. */
  relevance: number;
}

export interface MemoryPort {
  /** Semantic/keyword recall for PLAN (top-k). */
  query(loopId: string, q: string, k: number): Promise<MemoryHit[]>;
  /** Persist a distilled insight (MEMORY phase). */
  append(loopId: string, entry: { path: string; summary: string }): Promise<void>;
}

// ── Rubrics (the four gates as gradeable criteria) ────────────────────────────

export interface RubricPort {
  /** Gradeable criteria markdown per gate category for this loop. */
  criteria(loopId: string): Record<RubricCategory, string>;
}

// ── Persistence (audit spine + realtime feed) ─────────────────────────────────

export interface RunRecord {
  loopId: string;
  runId: string;
  phase: Phase;
  tickNo: number;
  cycle: number;
  iteration: number;
  costUsd: number;
  usage: TokenUsage;
  startedAt: string;
  endedAt: string;
}

export interface PersistencePort {
  /** Monotonic per-loop sequence allocator (owns the `(loop_id, seq)` cursor). */
  nextSeq(loopId: string): number;
  /** Append an event (Redis stream / Postgres / NDJSON / WS). */
  recordEvent(e: DeptEvent): void | Promise<void>;
  /** Persist one Run per (loop, phase, tick) — the audit spine. */
  recordRun(r: RunRecord): void | Promise<void>;
}

// ── Budget ledger (cost caps; precedence enforced in the engine) ──────────────

export type CapAction = 'ok' | 'downgrade' | 'pause';

export interface LedgerPort {
  /** Record usage for a run, returning the incremental cost in USD. */
  recordUsage(
    scope: { orgId?: string; loopId: string; runId: string },
    usage: TokenUsage,
    modelId: string,
  ): { costUsd: number };
  /** Current cap state for the loop (soft → downgrade, hard → pause). */
  checkCap(loopId: string): CapAction;
}

// ── Clock (deterministic in tests) ────────────────────────────────────────────

export interface Clock {
  now(): string;
}
export const systemClock: Clock = { now: () => new Date().toISOString() };
