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
// Phase 2: the real CMA adapter + SSE normalizer + Fable refusal-safe path.
export * from './normalizer.js';
export * from './cma.js';
export * from './fable.js';
