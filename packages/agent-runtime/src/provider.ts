/**
 * provider.ts — the ONE place a {@link LoopAgentRuntime} is chosen from configuration.
 *
 * The local driver, the CLI, and the Temporal activity all defer here so the
 * Ollama / Claude / Fake choice is made identically everywhere. Configuration arrives as
 * environment variables (the cockpit's run route forwards the user's Settings selection
 * into the spawned engine subprocess via these same names):
 *
 *   DEPARTMENTS_PROVIDER = ollama | claude | fake   (explicit; otherwise inferred)
 *   OLLAMA_BASE_URL      = http://localhost:11434   (default)
 *   OLLAMA_MODEL         = gemma4:12b-it-qat         (the pulled model to run)
 *   ANTHROPIC_API_KEY    = sk-ant-...                (enables the Claude provider)
 *   CLAUDE_MODEL         = claude-opus-4-8           (optional: pin one model for all roles)
 *
 * Inference when DEPARTMENTS_PROVIDER is unset: a Claude key → claude; else an Ollama
 * model → ollama; else the deterministic Fake runtime (offline demos/tests).
 */
import { FakeCmaRuntime } from './fake.js';
import { OllamaRuntime } from './ollama.js';
import { ClaudeRuntime } from './claude.js';
import type { LoopAgentRuntime } from './loop-runtime.js';
import { MODEL_TIERS, OLLAMA_LOCAL_MODEL_ID, getTier, type Effort, type ModelId } from './models.js';

export type ProviderKind = 'ollama' | 'claude' | 'fake';

export interface ProviderConfig {
  provider: ProviderKind;
  ollamaBaseUrl: string;
  ollamaModel?: string;
  /** Optional per-role Ollama model overrides (planner/executor/reviewer/docs). */
  ollamaRoleModels?: Record<string, string>;
  anthropicApiKey?: string;
  claudeModel?: ModelId;
}

type Env = Record<string, string | undefined>;

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/** Resolve the provider configuration from environment variables. */
export function providerConfigFromEnv(env: Env = process.env): ProviderConfig {
  const explicit = (env.DEPARTMENTS_PROVIDER ?? '').toLowerCase();
  const ollamaModel = env.OLLAMA_MODEL?.trim() || undefined;
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;

  let provider: ProviderKind;
  if (explicit === 'ollama' || explicit === 'claude' || explicit === 'fake') {
    provider = explicit;
  } else if (anthropicApiKey) {
    provider = 'claude';
  } else if (ollamaModel) {
    provider = 'ollama';
  } else {
    provider = 'fake';
  }

  return {
    provider,
    ollamaBaseUrl: env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL,
    ollamaModel,
    ollamaRoleModels: parseRoleModels(env.OLLAMA_ROLE_MODELS),
    anthropicApiKey,
    claudeModel: (env.CLAUDE_MODEL?.trim() as ModelId | undefined) || undefined,
  };
}

/** Parse the `OLLAMA_ROLE_MODELS` env (a JSON role→model map) defensively. */
function parseRoleModels(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Build the configured runtime, with actionable errors when creds/model are missing. */
export function runtimeFromConfig(cfg: ProviderConfig): LoopAgentRuntime {
  switch (cfg.provider) {
    case 'ollama':
      if (!cfg.ollamaModel) {
        throw new Error('Provider "ollama" selected but OLLAMA_MODEL is not set — pick an installed model in Settings.');
      }
      return new OllamaRuntime({ baseUrl: cfg.ollamaBaseUrl, model: cfg.ollamaModel, roleModels: cfg.ollamaRoleModels });
    case 'claude':
      if (!cfg.anthropicApiKey) {
        throw new Error('Provider "claude" selected but ANTHROPIC_API_KEY is not set — add an API key in Settings.');
      }
      return new ClaudeRuntime({ apiKey: cfg.anthropicApiKey, model: cfg.claudeModel });
    case 'fake':
    default:
      return new FakeCmaRuntime();
  }
}

/** Convenience: resolve config from env and build the runtime in one call. */
export function runtimeFromEnv(env: Env = process.env): LoopAgentRuntime {
  return runtimeFromConfig(providerConfigFromEnv(env));
}

// ─── Provider → per-role model binding ───────────────────────────────────────────

export interface ProviderRoleModel {
  modelId: ModelId;
  effort: Effort | null;
}
/** The four canonical roster roles the engine drives (structurally = LoopSpec['roles']). */
export type ProviderRoles = Record<'planner' | 'executor' | 'reviewer' | 'docs', ProviderRoleModel>;

/**
 * Bind every loop role to a model that MATCHES the configured provider, so the ledger
 * prices each phase against the model the runtime actually calls. CRITICAL for cost
 * correctness: an Ollama run must use the `$0` `ollama-local` sentinel for every role, or
 * the engine bills local tokens at the default Opus/Sonnet tier and trips the budget cap.
 *
 *   - ollama → every role is `ollama-local` (knobless, $0).
 *   - claude + pinned model → every role uses that one model at its legal default effort.
 *   - claude (no pin) / fake → `undefined` ⇒ the caller's default tiering (Opus/Sonnet).
 */
export function providerRoles(cfg: ProviderConfig): ProviderRoles | undefined {
  if (cfg.provider === 'ollama') {
    const m: ProviderRoleModel = { modelId: OLLAMA_LOCAL_MODEL_ID, effort: null };
    return { planner: m, executor: m, reviewer: m, docs: m };
  }
  if (cfg.provider === 'claude' && cfg.claudeModel && MODEL_TIERS.some((t) => t.modelId === cfg.claudeModel)) {
    const m: ProviderRoleModel = { modelId: cfg.claudeModel, effort: getTier(cfg.claudeModel).defaultEffort };
    return { planner: m, executor: m, reviewer: m, docs: m };
  }
  return undefined;
}
