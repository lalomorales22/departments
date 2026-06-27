/**
 * @departments/agent-runtime — the model-access boundary (interface + policy).
 *
 * The orchestration engine NEVER calls Claude directly; it only holds an
 * {@link AgentRuntime} and consults the {@link MODEL_TIERS} policy. This barrel
 * re-exports the contract (runtime) and the tier/effort policy (models). Phase 2
 * adds the concrete `cma` adapter behind the same `AgentRuntime` interface.
 */
export * from './runtime.js';
export * from './models.js';
export * from './loop-runtime.js';
export * from './fake.js';
// Real chat-completion runtimes: a shared cognition base + the Ollama (local) and Claude
// (direct Messages API) providers, plus the env-driven provider selector. This is the
// seam that makes a loop actually THINK instead of replaying canned output.
export * from './completion-runtime.js';
export * from './ollama.js';
export * from './claude.js';
export * from './provider.js';
export * from './batch.js';
// Phase 2: the real CMA adapter + SSE normalizer + Fable refusal-safe path.
export * from './normalizer.js';
export * from './cma.js';
export * from './fable.js';
// Phase 5: security posture (secret hygiene, prompt-injection, network egress) + Vaults.
export * from './security.js';
export * from './vault.js';
