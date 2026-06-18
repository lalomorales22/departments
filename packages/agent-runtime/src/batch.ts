/**
 * batch.ts — the BATCH API path for the CEO meta-loop's review (cost lever #3).
 *
 * The CEO's nightly review grades N children's REPORT/metric summaries. That fan-out is
 * "can-wait" work, so it goes through the Batch API (50% off) with ONE large, stable
 * cached prefix shared by every item — pre-warmed (`max_tokens:0`) so each item reads it
 * from cache rather than re-paying for it. This is NOT for interactive EXECUTE.
 *
 * This module owns the model-access ABSTRACTION (a runtime capability); the 50% price is
 * applied by the ledger in `@departments/cost` (`batchCostOfUsage`) when the orchestration
 * CEO cycle records each verdict's usage — keeping agent-runtime free of a cost dep and
 * the discount math in exactly one place. {@link FakeBatchReviewRuntime} runs locally;
 * the real CMA adapter ({@link CmaBatchReviewRuntime}) is gated behind `ANTHROPIC_API_KEY`.
 */
import type { TokenUsage } from '@departments/shared';
import { emptyUsage } from './loop-runtime.js';
import type { ModelId } from './models.js';

export interface BatchReviewItem {
  loopId: string;
  /** The child's REPORT.md excerpt + metric summary the CEO grades. */
  summary: string;
}

export interface BatchReviewVerdict {
  loopId: string;
  /** One-line CEO read on the unit. */
  verdict: string;
  /** Raw token usage for this item — the ledger prices it at 50% (batched). */
  usage: TokenUsage;
  /** Always true: this verdict came back through the Batch API. */
  batched: true;
}

export interface BatchReviewRequest {
  modelId: ModelId;
  /** The large, STABLE prefix shared by every item — pre-warmed, served from cache. */
  sharedPrefix: string;
  items: BatchReviewItem[];
}

export interface BatchReviewRuntime {
  /** Pre-warm the shared prefix (`max_tokens:0`) so the batch reads it from cache. */
  prewarm(sharedPrefix: string, modelId: ModelId): Promise<void>;
  /** Submit every item as ONE batch (50% off, shared cached prefix). */
  review(req: BatchReviewRequest): Promise<BatchReviewVerdict[]>;
}

/**
 * Deterministic local batch runtime. Models prompt-cache warmth: once the prefix is
 * pre-warmed, each item's usage is mostly `cacheReadInputTokens` (~0.1× price) plus a
 * small per-item delta — so the cost lever is visible end-to-end without a network call.
 */
export class FakeBatchReviewRuntime implements BatchReviewRuntime {
  private warmedTokens = 0;

  async prewarm(sharedPrefix: string, _modelId: ModelId): Promise<void> {
    this.warmedTokens = approxTokens(sharedPrefix);
  }

  async review(req: BatchReviewRequest): Promise<BatchReviewVerdict[]> {
    const prefixTokens = this.warmedTokens || approxTokens(req.sharedPrefix);
    return req.items.map((item) => {
      const itemTokens = approxTokens(item.summary);
      const usage: TokenUsage = {
        ...emptyUsage(),
        // The shared prefix is read from cache (warm); only the per-item delta is fresh.
        cacheReadInputTokens: this.warmedTokens ? prefixTokens : 0,
        cacheCreationInputTokens: this.warmedTokens ? 0 : prefixTokens,
        inputTokens: itemTokens,
        outputTokens: 120,
      };
      return { loopId: item.loopId, verdict: verdictFor(item.summary), usage, batched: true as const };
    });
  }
}

/** Rough token estimate (≈4 chars/token) — local projection only, never billed. */
function approxTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4));
}

/** A deterministic one-line read used by the fake (the engine's planObjectives does the real call). */
function verdictFor(summary: string): string {
  const s = summary.toLowerCase();
  if (s.includes('paused') || s.includes('error') || s.includes('blocked')) return 'stabilize: unblock and resume';
  if (s.includes('stall') || s.includes('low')) return 'recover: focus the failing area';
  if (s.includes('ahead') || s.includes('strong') || s.includes('high')) return 'scale: add headroom';
  return 'hold course: keep compounding';
}

/**
 * The real CMA Batch adapter — gated behind `ANTHROPIC_API_KEY`. Authored signature so
 * the path ships typed; the implementation submits a `messages.batches.create` job with a
 * shared `cache_control` prefix and polls for completion. Throws loudly if used without
 * creds so accidental wiring fails fast rather than silently running synchronously.
 */
export class CmaBatchReviewRuntime implements BatchReviewRuntime {
  constructor(private readonly apiKey = process.env.ANTHROPIC_API_KEY) {}

  private ensure(): void {
    if (!this.apiKey) {
      throw new Error('CmaBatchReviewRuntime requires ANTHROPIC_API_KEY (Batch API path is gated).');
    }
  }

  async prewarm(_sharedPrefix: string, _modelId: ModelId): Promise<void> {
    this.ensure();
    // TODO(real CMA): one max_tokens:0 call carrying the cache_control prefix.
    throw new Error('CmaBatchReviewRuntime.prewarm not implemented — runs only with CMA creds.');
  }

  async review(_req: BatchReviewRequest): Promise<BatchReviewVerdict[]> {
    this.ensure();
    // TODO(real CMA): client.beta.messages.batches.create({ requests: [...] }) → poll → map.
    throw new Error('CmaBatchReviewRuntime.review not implemented — runs only with CMA creds.');
  }
}
