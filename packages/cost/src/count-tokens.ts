/**
 * @departments/cost — token pre-check before large/batch submissions.
 *
 * A `count_tokens` pre-check sizes a prompt before a costly submission (large
 * single calls, or the CEO's Batch-API fan-out across every loop) so the budget
 * ledger and concurrency semaphore can decide before tokens are spent. Token
 * counts are MODEL-SPECIFIC — pass the exact model ID you'll submit with. Never
 * estimate with `tiktoken` (it undercounts Claude tokens by ~15–20%, far more on
 * code); the real implementation calls the Messages API `count_tokens` endpoint
 * (`POST /v1/messages/count_tokens`) via the agent-runtime package.
 *
 * This file defines the SIGNATURE only. The implementation lands when
 * agent-runtime owns model access (the cost package never talks to the API
 * directly). The stub throws a clear NotImplemented so accidental wiring fails
 * loudly rather than returning a bogus 0.
 */

/** A minimal, transport-safe message shape for a count-tokens pre-check. */
export interface CountTokensMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Input to a token pre-check. Mirrors the Messages API count-tokens body. */
export interface CountTokensRequest {
  /** Exact model ID — counts are model-specific (e.g. 'claude-opus-4-8'). */
  modelId: string;
  messages: CountTokensMessage[];
  /** Optional system prompt — counted as part of the prefix. */
  system?: string;
}

/** Marker error thrown by the {@link countTokens} stub until Phase 2 wires it. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`NotImplemented: ${what}`);
    this.name = 'NotImplementedError';
  }
}

/**
 * Pre-check the token count of a prompt before a large/batch submission.
 *
 * TODO(Phase 2): implement via agent-runtime's `count_tokens` wrapper
 * (`client.messages.count_tokens({ model, messages, system }).input_tokens`).
 * Until then this is a typed no-op that throws — do not catch-and-default it to 0.
 *
 * @returns the input-token count for the request (model-specific).
 */
export function countTokens(_request: CountTokensRequest): Promise<number> {
  return Promise.reject(
    new NotImplementedError('countTokens — wire to agent-runtime messages.count_tokens in Phase 2'),
  );
}
