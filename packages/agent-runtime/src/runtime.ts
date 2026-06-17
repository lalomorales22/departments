/**
 * @departments/agent-runtime — the agent-runtime abstraction (interface only).
 *
 * This is the SINGLE seam through which the orchestration engine touches a model
 * provider. The engine NEVER calls Claude (the Messages API) directly: it only ever
 * holds an {@link AgentRuntime}. That makes the **CMA-vs-self-hosted** choice a
 * *deployment detail* hidden behind this interface, not an architectural fork —
 *
 *   - CMA (cloud)        → `client.beta.{agents,sessions,outcomes}.*`
 *   - self_hosted        → an equivalent adapter for regulated tenants (Phase 5),
 *                          backed by pgvector-as-primary-memory + host-side tool creds.
 *
 * Phase 1 ships ONLY the contract. Phase 2 implements `agent-runtime/cma` against
 * these four methods; nothing here calls a model, and there is no provider logic.
 *
 * Boundary invariant (see README "Boundary"): `orchestration` owns the cycle and
 * never calls Claude; `agent-runtime` is the only package that talks to CMA / the
 * Messages API. These types exist so that the boundary is type-checked, not prose.
 */
import type { AgentRole, Phase, RubricCategory } from '@departments/shared';
import type { ModelId } from './models.js';

// ─── Identifiers ────────────────────────────────────────────────────────────

/** Opaque handle for one loop run = one provider session (CMA Session). */
export type SessionId = string & { readonly __brand: 'SessionId' };
/** Opaque handle for one EVALUATE/IMPROVE grader context (CMA Outcome). */
export type OutcomeId = string & { readonly __brand: 'OutcomeId' };

// ─── startSession ─────────────────────────────────────────────────────────────

/**
 * Everything the runtime needs to provision a run. Deliberately minimal: it names a
 * pre-provisioned Agent template (created once, referenced by ID — never per tick),
 * not an inline model/tool config, so the request path stays cache-shaped.
 */
export interface StartSessionInput {
  /** The loop this run belongs to (tenant + cadence + ledger scope upstream). */
  readonly loopId: string;
  /** Pre-provisioned Agent/department template id (e.g. a CMA Agent). */
  readonly agentTemplateId: string;
  /** Canonical roster role this session embodies. */
  readonly role: AgentRole;
  /** Phase the run starts in (resumable bootstrap → cycle phases). */
  readonly phase: Phase;
  /** Resume token from the prior cycle's `HANDOFF.md` pointer, if resuming. */
  readonly resumeFrom?: string;
}

/** A live (or resumable) session the engine can stream and steer. */
export interface SessionHandle {
  readonly sessionId: SessionId;
  readonly loopId: string;
  readonly role: AgentRole;
  /** Model the provider bound to this session (for the ledger / observability). */
  readonly modelId: ModelId;
}

// ─── sendEvents ─────────────────────────────────────────────────────────────

/**
 * An inbound steer event pushed INTO a running session (e.g. a mid-conversation
 * `role:"system"` per-tick context message, a `run_now` nudge, a tool confirmation).
 * Kept as an opaque payload here; the wire shape is owned by `@departments/events`.
 */
export interface RuntimeInboundEvent {
  readonly kind: string;
  readonly payload: unknown;
}

// ─── defineOutcome ─────────────────────────────────────────────────────────────

/**
 * Spec for an independent grading context (EVALUATE). Runs in its OWN session so an
 * agent can never grade its own work (no self-grading on Alignment/Risk). Maps to
 * CMA `user.define_outcome` in Phase 2.
 */
export interface OutcomeSpec {
  /** Gate categories this outcome scores. */
  readonly rubric: readonly RubricCategory[];
  /** Cap the iterate→grade→revise loop (IMPROVE) before it gives up. */
  readonly maxIterations: number;
}

/** Handle to a defined outcome; resolution is observed via {@link AgentRuntime.streamEvents}. */
export interface OutcomeHandle {
  readonly outcomeId: OutcomeId;
  readonly sessionId: SessionId;
}

// ─── The abstraction ────────────────────────────────────────────────────────

/**
 * The four-method runtime contract. NO implementation here — Phase 1 is contract-only.
 *
 * `streamEvents` yields the provider's raw, un-normalized event stream (CMA SSE);
 * `@departments/events` owns turning that into the frozen `Event` protocol. Returning
 * `unknown` keeps the normalizer the single place provider shapes are interpreted.
 */
export interface AgentRuntime {
  /** Provision a run (a provider Session + its container/artifact substrate). */
  startSession(input: StartSessionInput): Promise<SessionHandle>;

  /** Push inbound steer events into a running session (per-tick context, nudges). */
  sendEvents(sessionId: SessionId, events: readonly RuntimeInboundEvent[]): Promise<void>;

  /** Subscribe to the session's raw provider event stream (normalized downstream). */
  streamEvents(sessionId: SessionId): AsyncIterable<unknown>;

  /** Open an independent grading context against a session (EVALUATE/IMPROVE). */
  defineOutcome(sessionId: SessionId, spec: OutcomeSpec): Promise<OutcomeHandle>;
}
