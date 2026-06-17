/**
 * callFableSafe — the Fable 5 refusal-safe path (TASKS.md Phase 2 AI task).
 *
 * Claude Fable 5 runs safety classifiers that may decline a request: the API returns a
 * successful HTTP 200 with `stop_reason: "refusal"` rather than content. Left unhandled,
 * a single false-positive refusal would kill a loop tick. This wraps a Messages-shaped
 * call so the refusal-recovery path ships *tested*, per the model facts:
 *
 *   - opt into server-side fallbacks by default:
 *       betas: ["server-side-fallback-2026-06-01"], fallbacks: [{model:"claude-opus-4-8"}]
 *   - Fable 5 requires 30-day data retention (not available under ZDR) — surfaced as a
 *     note on the request so the caller can assert the org config before shipping.
 *   - check `stop_reason` BEFORE reading `content` (a pre-output refusal has empty
 *     content; a mid-stream refusal billed the streamed partial — discard it).
 *
 * This is a PURE function over an injected client interface — it never imports
 * `@anthropic-ai/sdk`, so it is unit-testable with a fake and the CMA-vs-self-hosted
 * choice stays a deployment detail.
 */

/** The exact beta header that enables the server-side `fallbacks` parameter. */
export const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-06-01' as const;

/** Fable 5 is unavailable under ZDR; it needs at least 30-day retention. */
export const FABLE_MIN_RETENTION_DAYS = 30 as const;

/** A content block in a Messages-shaped response (only the fields we read). */
export interface FableContentBlock {
  readonly type: string;
  /** Present on `text` blocks. */
  readonly text?: string;
  /** Present on `fallback` switch-point blocks. */
  readonly from?: { readonly model?: string };
  readonly to?: { readonly model?: string };
}

/** A per-attempt usage iteration entry (the served-by signal). */
export interface FableIteration {
  readonly type: string;
  readonly model?: string;
}

/** The subset of a Messages response `callFableSafe` inspects. */
export interface FableResponse {
  /** Model that produced the returned message (the fallback model after a switch). */
  readonly model?: string;
  readonly stop_reason: string;
  readonly stop_details?: { readonly category?: string | null } | null;
  readonly content: readonly FableContentBlock[];
  readonly usage?: { readonly iterations?: readonly FableIteration[] | null };
}

/** Request params the caller controls; `model`/betas/fallbacks are filled in here. */
export interface FableCallParams {
  /** Final user instruction / messages payload (opaque to this layer). */
  readonly messages: ReadonlyArray<{ readonly role: string; readonly content: unknown }>;
  readonly maxTokens: number;
  /** `output_config.effort` — Fable supports `xhigh`/`max` (omit `thinking`). */
  readonly effort?: 'xhigh' | 'max';
  /** Optional frozen system prefix (cache-shaped). */
  readonly system?: string;
  /** Override the fallback model chain (defaults to `claude-opus-4-8`). */
  readonly fallbackModels?: readonly string[];
}

/** The shape of the request body this layer hands to the injected client. */
export interface FableRequest {
  readonly model: 'claude-fable-5';
  readonly max_tokens: number;
  readonly betas: readonly string[];
  readonly fallbacks: ReadonlyArray<{ readonly model: string }>;
  readonly messages: ReadonlyArray<{ readonly role: string; readonly content: unknown }>;
  readonly system?: string;
  readonly output_config?: { readonly effort: 'xhigh' | 'max' };
  /**
   * NOTE: no `thinking` block — Fable's thinking is always-on and must be OMITTED
   * (sending `{type:"disabled"}` 400s). No `temperature`/`top_p`/`top_k`/`budget_tokens`
   * either — depth is controlled by `output_config.effort`.
   */
  readonly metadata: { readonly retention_note: string };
}

/**
 * The minimal injected client. The real impl forwards to
 * `client.beta.messages.create`; the test passes a fake.
 */
export interface FableClient {
  createMessage(req: FableRequest): Promise<FableResponse>;
}

export interface FableSafeResult {
  /** Concatenated text of the returned message (empty iff the whole chain refused). */
  readonly text: string;
  /** Final stop reason — `'refusal'` only if EVERY model in the chain declined. */
  readonly stopReason: string;
  /** Model that actually produced the returned message. */
  readonly servedBy: string | undefined;
  /** True when a fallback model produced the answer (the requested model refused). */
  readonly servedByFallback: boolean;
  /** True iff the whole chain refused (caller should surface, not retry blindly). */
  readonly refused: boolean;
  /** Policy category on a refusal, when CMA provided one. */
  readonly refusalCategory: string | null | undefined;
  /** Switch points: each model that ran and declined this turn. */
  readonly switches: ReadonlyArray<{ from: string | undefined; to: string | undefined }>;
}

/**
 * Make a refusal-safe Fable 5 call. On `stop_reason:"refusal"` the server-side
 * fallback chain has already re-served (or also refused); we surface whichever
 * answer came back and never read `content` before checking `stop_reason`.
 */
export async function callFableSafe(
  client: FableClient,
  params: FableCallParams,
): Promise<FableSafeResult> {
  const fallbackModels =
    params.fallbackModels && params.fallbackModels.length > 0
      ? params.fallbackModels
      : (['claude-opus-4-8'] as const);

  const req: FableRequest = {
    model: 'claude-fable-5',
    max_tokens: params.maxTokens,
    betas: [SERVER_SIDE_FALLBACK_BETA],
    fallbacks: fallbackModels.map((model) => ({ model })),
    messages: params.messages,
    ...(params.system !== undefined ? { system: params.system } : {}),
    ...(params.effort !== undefined ? { output_config: { effort: params.effort } } : {}),
    metadata: {
      retention_note: `requires >= ${FABLE_MIN_RETENTION_DAYS}-day data retention (not available under ZDR)`,
    },
  };

  const res = await client.createMessage(req);

  // Switch points + served-by signal (covers sticky turns that carry no block).
  const switches: Array<{ from: string | undefined; to: string | undefined }> = [];
  for (const block of res.content) {
    if (block.type === 'fallback') {
      switches.push({ from: block.from?.model, to: block.to?.model });
    }
  }
  const iterations = res.usage?.iterations ?? [];
  const fallbackRan = iterations.some((it) => it.type === 'fallback_message');

  // ── Check stop_reason BEFORE reading content. ──
  const refused = res.stop_reason === 'refusal';
  const text = refused ? '' : textOf(res.content);

  return {
    text,
    stopReason: res.stop_reason,
    servedBy: res.model,
    // A fallback served the response when a fallback ran AND the chain didn't ultimately refuse.
    servedByFallback: (fallbackRan || switches.length > 0) && !refused,
    refused,
    refusalCategory: refused ? (res.stop_details?.category ?? undefined) : undefined,
    switches,
  };
}

function textOf(content: readonly FableContentBlock[]): string {
  let out = '';
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') out += block.text;
  }
  return out;
}
