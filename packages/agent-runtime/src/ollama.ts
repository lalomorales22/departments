/**
 * OllamaRuntime — a REAL, local {@link LoopAgentRuntime} backed by an Ollama daemon
 * (default http://localhost:11434). No cloud, no API key, no cost: the cognition runs on
 * the user's own hardware. All the cycle logic lives in {@link CompletionLoopRuntime};
 * this file only knows how to stream Ollama's `/api/chat` NDJSON.
 *
 * The engine accounts against the `ollama-local` sentinel {@link ModelId} (knobless, $0);
 * the REAL model name (e.g. `gemma4:12b-it-qat`) rides on this instance.
 */
import type { AgentRole, TokenUsage } from '@departments/shared';
import { OLLAMA_LOCAL_MODEL_ID, type ModelId } from './models.js';
import { emptyUsage } from './loop-runtime.js';
import { CompletionLoopRuntime, type ChatMessage, type CompletionResult } from './completion-runtime.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';
/** Cap per-phase generation so a cycle stays responsive on local hardware. */
const DEFAULT_NUM_PREDICT = 768;

export interface OllamaRuntimeOptions {
  /** Ollama daemon base URL. Default http://localhost:11434. */
  baseUrl?: string;
  /** The DEFAULT Ollama model name to run, e.g. `gemma4:12b-it-qat`, `qwen3.6:latest`. */
  model: string;
  /**
   * Optional per-role model overrides. A role present here runs that model instead of the
   * default — so the user can give planner/reviewer a stronger model than executor/docs.
   */
  roleModels?: Partial<Record<AgentRole, string>>;
  /** Max tokens to generate per phase turn (`options.num_predict`). */
  numPredict?: number;
  /** Sampling temperature. Default 0.6. */
  temperature?: number;
  /** Injectable fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class OllamaRuntime extends CompletionLoopRuntime {
  protected readonly providerLabel = 'Ollama';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly roleModels: Partial<Record<AgentRole, string>>;
  private readonly numPredict: number;
  private readonly temperature: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OllamaRuntimeOptions) {
    super();
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = opts.model;
    this.roleModels = opts.roleModels ?? {};
    this.numPredict = opts.numPredict ?? DEFAULT_NUM_PREDICT;
    this.temperature = opts.temperature ?? 0.6;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Local models are always billed against the knobless, $0 sentinel tier. */
  protected resolveAccountingModelId(_modelId: ModelId): ModelId {
    return OLLAMA_LOCAL_MODEL_ID;
  }

  /** A per-role override if set, else the default local model. */
  protected resolveCallModel(_modelId: ModelId, role: AgentRole): string {
    return this.roleModels[role] || this.model;
  }

  protected async complete(callModel: string, messages: ChatMessage[], onDelta?: (d: string) => void): Promise<CompletionResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: callModel,
        messages,
        stream: true,
        // Thinking models otherwise spend the whole token budget reasoning and return
        // EMPTY content — we want the answer (artifacts), not the chain-of-thought.
        // Verified to be a no-op (not an error) on non-thinking models.
        think: false,
        options: { num_predict: this.numPredict, temperature: this.temperature },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''} (is \`ollama serve\` running and \`${callModel}\` pulled?)`);
    }
    if (!res.body) throw new Error('Ollama returned no response body.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let thinking = '';
    let usage: TokenUsage = emptyUsage();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let obj: OllamaChatChunk;
        try {
          obj = JSON.parse(line) as OllamaChatChunk;
        } catch {
          continue; // tolerate a partial / non-JSON keep-alive line
        }
        if (obj.error) throw new Error(`Ollama error: ${obj.error}`);
        const delta = obj.message?.content ?? '';
        if (delta) {
          text += delta;
          onDelta?.(delta);
        }
        if (obj.message?.thinking) thinking += obj.message.thinking;
        if (obj.done) {
          usage = {
            inputTokens: obj.prompt_eval_count ?? 0,
            outputTokens: obj.eval_count ?? 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          };
        }
      }
    }
    // Safety net: if a model ignored think:false and produced only thinking, use it so a
    // phase still writes a meaningful artifact instead of an empty one.
    if (!text.trim() && thinking.trim()) {
      text = thinking;
      onDelta?.(thinking);
    }
    return { text, usage };
  }
}

interface OllamaChatChunk {
  message?: { role: string; content: string; thinking?: string };
  done?: boolean;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}
