/**
 * @departments/cost — prompt-caching helpers (the #1 cost lever).
 *
 * Prompt caching is a PREFIX MATCH: any byte change anywhere in the prefix
 * invalidates everything after it. Render order is `tools` → `system` →
 * `messages`. The repeated prefix across every loop tick (frozen system prompt +
 * tool/skill defs + shared department/project context) is large and stable, and
 * cache reads cost ~0.1× the input price — so freezing that prefix is the single
 * biggest cost win for a loop that "re-runs constantly."
 *
 * These are pure, documented helpers. They describe WHERE to place the
 * `cache_control` marker and HOW to verify a cache hit; they do not call the API
 * (the agent-runtime package owns all model access).
 */
import type { TokenUsage } from '@departments/shared';

// ─────────────────────────────────────────────────────────────────────────────
// cache_control placement guidance
// ─────────────────────────────────────────────────────────────────────────────

/** The three render segments, in prefix order, where a breakpoint can live. */
export type CacheSegment = 'tools' | 'system' | 'messages';

/** The cache_control marker shape sent on a content block. */
export interface CacheControlMarker {
  type: 'ephemeral';
  /** 5-minute TTL by default; '1h' keeps the prefix alive across bursty gaps. */
  ttl?: '5m' | '1h';
}

/**
 * Typed guidance describing where the cache breakpoint belongs for a stable
 * loop-tick prefix, and why. The runtime adapter consumes this to place the
 * marker correctly; it is not an SDK type.
 */
export interface CacheControlPlacement {
  /** Which render segment carries the breakpoint. */
  segment: CacheSegment;
  /**
   * Index of the block within that segment to mark, or `'last'` for the last
   * cacheable block. A breakpoint on the last system block caches tools + system
   * together (tools render before system).
   */
  blockIndex: number | 'last';
  /** The marker to attach. */
  marker: CacheControlMarker;
  /** Why this placement — for docs/audit. */
  rationale: string;
}

/**
 * Recommended placement for a loop tick's stable prefix.
 *
 * The frozen prefix is `tools` (deterministic order) + `system` (no
 * `datetime.now()`/UUIDs). Put the breakpoint on the LAST system block so the
 * marker caches both tools and system; inject the per-tick volatile context AFTER
 * this breakpoint — as a mid-conversation `role: "system"` message (preferred,
 * see {@link MID_CONVERSATION_SYSTEM_NOTE}) or as user-turn content — so it never
 * invalidates the cached prefix.
 *
 * @param ttl optional TTL; use `'1h'` for loops whose ticks are spaced further
 *            apart than the 5-minute default cache lifetime.
 */
export function cacheControlForPrefix(ttl: CacheControlMarker['ttl'] = '5m'): CacheControlPlacement {
  return {
    segment: 'system',
    blockIndex: 'last',
    marker: { type: 'ephemeral', ttl },
    rationale:
      'Breakpoint on the last system block caches tools + system (render order ' +
      'tools → system → messages). Keep this prefix frozen; inject per-tick ' +
      'context after it so the cached prefix survives every tick.',
  };
}

/**
 * Guidance string: per-tick context belongs in a mid-conversation system message
 * (`role: "system"` appended to `messages[]`), not interpolated into the
 * top-level system prompt — that keeps the cached prefix byte-identical across
 * ticks while still delivering operator-authority context.
 */
export const MID_CONVERSATION_SYSTEM_NOTE =
  'Inject per-tick context as a mid-conversation `role:"system"` message appended ' +
  'to messages[], not by editing the top-level system prompt — editing the prefix ' +
  'invalidates every cached tick after it.';

/**
 * freezePrefix — doc-stub for the Phase 2 prefix freezer.
 *
 * The implementation will assert a candidate prefix is cache-stable: no
 * `datetime.now()`/`Date.now()`/UUIDs, deterministic tool ordering (sort by
 * name), and deterministic JSON serialization (sorted keys). For now it documents
 * the contract and is intentionally a no-op pass-through so call sites can be
 * wired before the audit logic exists.
 *
 * @param prefix the candidate stable prefix (opaque to this stub).
 * @returns the same prefix, unchanged.
 */
export function freezePrefix<T>(prefix: T): T {
  // TODO(Phase 2): audit for silent cache invalidators (timestamps, UUIDs,
  // non-deterministic JSON/tool order) and throw/normalize. No-op for now.
  return prefix;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache-hit verification (the Phase 2 CI assert)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether a call actually read from the prompt cache, i.e.
 * `cache_read_input_tokens > 0`. The Phase 2 CI asserts this across ticks of the
 * same loop — if it's ~0 across ticks, a silent invalidator is at work (a
 * timestamp/UUID in the prefix, unsorted JSON, or a varying tool set) and the #1
 * cost lever is silently disabled.
 */
export function assertCacheHit(usage: TokenUsage): boolean {
  return usage.cacheReadInputTokens > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache audit (Phase 5) — alert on ~0 reads AND on mid-life degradation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fraction of total input below which a tick is "effectively cold" — at or under
 * this, the cached prefix is not paying off and the #1 lever is (near) disabled.
 */
export const CACHE_COLD_RATIO = 0.05 as const;

/**
 * Fraction of total input at or above which a tick counts as "warm" — used as the
 * baseline a later cold tick is compared against to detect mid-life degradation.
 */
export const CACHE_WARM_RATIO = 0.5 as const;

/**
 * Fraction of a call's *input* tokens served from cache:
 * `cacheRead / (input + cacheRead + cacheCreation)`. Output tokens are excluded —
 * caching is a prompt(input)-prefix lever. Returns 0 when there is no input at all.
 */
export function cacheReadRatio(usage: TokenUsage): number {
  const totalInput =
    usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
  return totalInput > 0 ? usage.cacheReadInputTokens / totalInput : 0;
}

/** The result of auditing one tick's cache efficacy. */
export interface CacheAudit {
  /** `cache_read_input_tokens > 0` this call. */
  hit: boolean;
  /** Fraction of input served from cache (0–1). */
  readRatio: number;
  /** At/under {@link CACHE_COLD_RATIO} — the cache is not paying off this tick. */
  cold: boolean;
  /**
   * MID-LIFE DEGRADATION: a prior tick of the same loop was warm but this one
   * collapsed to cold. This is the dangerous case the Phase 5 audit adds over the
   * Phase 2 "is it ever warm" check — a prompt/tool change via continue-as-new can
   * silently kill caching after the loop was already warm. Only set when a warm prior
   * ratio is supplied (the first/cold-start tick is expected cold, not degraded).
   */
  degraded: boolean;
}

/**
 * Audit one tick's cache efficacy. Pass the loop's PRIOR warm read-ratio to detect
 * mid-life degradation; omit it on the first tick (cold start is expected, not a
 * regression).
 */
export function auditCacheHit(usage: TokenUsage, priorReadRatio?: number): CacheAudit {
  const readRatio = cacheReadRatio(usage);
  const cold = readRatio <= CACHE_COLD_RATIO;
  const degraded =
    priorReadRatio !== undefined && priorReadRatio >= CACHE_WARM_RATIO && cold;
  return { hit: usage.cacheReadInputTokens > 0, readRatio, cold, degraded };
}

/**
 * Rolling per-loop cache auditor: remembers the last *warm* read-ratio per loop so a
 * later cold tick is flagged as degradation rather than an expected cold start. The
 * engine records every tick here and surfaces a WARN/alert when `degraded` is true.
 */
export class CacheAuditor {
  /** Last observed warm read-ratio per loop (only warm ticks update the baseline). */
  private readonly warmBaseline = new Map<string, number>();

  /** Audit a tick for a loop and update its warm baseline. */
  record(loopId: string, usage: TokenUsage): CacheAudit {
    const prior = this.warmBaseline.get(loopId);
    const audit = auditCacheHit(usage, prior);
    if (audit.readRatio >= CACHE_WARM_RATIO) this.warmBaseline.set(loopId, audit.readRatio);
    return audit;
  }

  /** The remembered warm baseline for a loop, if any (for dashboards/tests). */
  baselineFor(loopId: string): number | undefined {
    return this.warmBaseline.get(loopId);
  }
}
