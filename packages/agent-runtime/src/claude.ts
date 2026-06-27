/**
 * ClaudeRuntime — a REAL {@link LoopAgentRuntime} over the Anthropic Messages API
 * (direct HTTP; no SDK dependency). Selected when the user picks the "Claude" provider
 * and supplies an API key. All cycle logic is shared with the local path via
 * {@link CompletionLoopRuntime}; this file only knows the Messages wire shape.
 *
 * By default each role calls the engine-tiered Claude model it was assigned (planner/
 * reviewer → Opus, executor/docs → Sonnet — the whole point of model tiering). An
 * optional `model` override pins ONE Claude model for every role instead.
 *
 * Knob safety: the call sends only `{model, max_tokens, system, messages}` — no
 * `temperature`/`thinking`/`budget_tokens`, which are exactly the params that 400 on
 * Opus/Fable. Depth is governed by model SELECTION (the tier), not by request knobs.
 */
import type { AgentRole, TokenUsage } from '@departments/shared';
import type { ModelId } from './models.js';
import { emptyUsage } from './loop-runtime.js';
import { CompletionLoopRuntime, type ChatMessage, type CompletionResult } from './completion-runtime.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;

export interface ClaudeRuntimeOptions {
  /** Anthropic API key (sk-ant-...). Required — without it the provider can't run. */
  apiKey: string;
  /** Override base URL (proxy/gateway). Default https://api.anthropic.com. */
  baseUrl?: string;
  /** Pin ONE Claude model for every role instead of the per-role tiering. */
  model?: ModelId;
  /** Max output tokens per phase turn. Default 1024. */
  maxTokens?: number;
  /** Injectable fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class ClaudeRuntime extends CompletionLoopRuntime {
  protected readonly providerLabel = 'Claude';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly override?: ModelId;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClaudeRuntimeOptions) {
    super();
    if (!opts.apiKey) throw new Error('ClaudeRuntime requires an Anthropic API key.');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.override = opts.model;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Account against whatever Claude id is actually called (real tier pricing). */
  protected resolveAccountingModelId(modelId: ModelId): ModelId {
    return this.override ?? modelId;
  }

  protected resolveCallModel(modelId: ModelId, _role: AgentRole): string {
    // Per-role tiering is already expressed in the engine's per-role modelId; an explicit
    // `model` override (when set) pins one model for every role.
    return this.override ?? modelId;
  }

  protected async complete(callModel: string, messages: ChatMessage[], onDelta?: (d: string) => void): Promise<CompletionResult> {
    // The Messages API takes `system` at the top level; messages are user/assistant only.
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const turns = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({ model: callModel, max_tokens: this.maxTokens, system, messages: turns }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
    }
    const json = (await res.json()) as MessagesResponse;
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');

    // Non-streaming: feed the terminal by chunking the final text through onDelta so the
    // cockpit still shows the model's output (live token streaming is a later enhancement).
    if (onDelta && text) {
      for (let i = 0; i < text.length; i += 80) onDelta(text.slice(i, i + 80));
    }

    const u = json.usage;
    const usage: TokenUsage = u
      ? {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
        }
      : emptyUsage();
    return { text, usage };
  }
}

interface MessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}
