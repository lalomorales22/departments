/**
 * CmaRuntime — the REAL CMA-backed {@link LoopAgentRuntime}.
 *
 * Implements the engine-facing cycle contract (`loop-runtime.ts`) against Anthropic
 * Managed Agents (CMA). Per the README "Concept→CMA mapping":
 *   Loop department template → Agent (created once, referenced by id)
 *   One loop run             → Session (provisions a container)
 *   EVALUATE / IMPROVE       → Outcomes (`user.define_outcome` + rubric → grader iterates)
 *   Live logs / status       → Session SSE → {@link CmaSseNormalizer}
 *
 * Design constraints baked in here:
 *   - Depends on an INJECTED {@link CmaClient} — NEVER imports `@anthropic-ai/sdk`, so
 *     the CMA-vs-self-hosted choice stays a deployment detail.
 *   - Cache-shaped request path: `startSession` references a pre-provisioned
 *     `agentTemplate` by id (model/system/tools live on the Agent, never inline per
 *     tick); the volatile per-tick instruction is delivered as a mid-conversation
 *     `role:"system"` message, not by editing the cached system prefix.
 *   - Model knobs are validated with {@link validateKnobs} BEFORE any call; a violation
 *     THROWS (a guaranteed-400 caught locally instead of at the API).
 */
import type { AgentRole, OutcomeResult, RubricCategory, TokenUsage } from '@departments/shared';
import { RUBRIC_CATEGORIES } from '@departments/shared';
import type {
  EvaluateRequest,
  EventSink,
  GateVerdict,
  LoopAgentRuntime,
  LoopSession,
  LoopSessionInput,
  OutcomeVerdict,
  PhaseRequest,
  PhaseResult,
} from './loop-runtime.js';
import { emptyUsage } from './loop-runtime.js';
import { getTier, validateKnobs, type Effort, type ModelId, type ModelKnobs } from './models.js';
import { CmaSseNormalizer, type RawCmaFrame } from './normalizer.js';

// ─── The injected CMA client interface (subset of client.beta.{agents,sessions}) ──

/** One event to push into a running session (`sessions.events.send`). */
export interface CmaInboundEvent {
  readonly type: string;
  readonly [k: string]: unknown;
}

/** The volatile per-tick mid-conversation `role:"system"` message. */
export interface CmaSystemMessageEvent extends CmaInboundEvent {
  readonly type: 'system.message';
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
}

/** A `user.define_outcome` event (EVALUATE). */
export interface CmaDefineOutcomeEvent extends CmaInboundEvent {
  readonly type: 'user.define_outcome';
  readonly description: string;
  readonly rubric: { readonly type: 'text'; readonly content: string };
  readonly max_iterations: number;
}

/** Result of creating a session. */
export interface CmaSession {
  readonly id: string;
  readonly status: string;
}

/**
 * The minimal CMA surface this runtime needs. Mirrors the real
 * `client.beta.{agents,sessions}.*` shape but stays SDK-free for DI + tests.
 *
 * `streamEvents` yields raw SSE frames AFTER the stream is opened (stream-first), so the
 * caller must open it before `sendEvents`.
 */
export interface CmaClient {
  /** Reference a pre-provisioned Agent template (never created in the request path). */
  getAgent(agentTemplateId: string): Promise<{ id: string; model: ModelId }>;
  /** Provision a run = one Session against the agent + a Git-mounted container. */
  createSession(input: {
    agentTemplateId: string;
    loopId: string;
    runId: string;
    workspaceDir: string;
  }): Promise<CmaSession>;
  /** Open the SSE stream (stream-first ordering — open BEFORE sending). */
  streamEvents(sessionId: string): AsyncIterable<RawCmaFrame>;
  /** Push events into a running session (mid-conversation system message, outcome). */
  sendEvents(sessionId: string, events: readonly CmaInboundEvent[]): Promise<void>;
  /** Archive the session (free the container) on teardown. */
  archiveSession(sessionId: string): Promise<void>;
}

// ─── Session handle carries the CMA session id + bound model ──────────────────

interface CmaLoopSession extends LoopSession {
  /** The CMA Session id (provider handle). */
  readonly cmaSessionId: string;
}

export interface CmaRuntimeOptions {
  /**
   * Resolve a role to its PRE-PROVISIONED Agent template id. Agent templates are created
   * once (via the `ant` YAML provisioning script) and referenced by id — never created
   * in the request path. Required so the runtime never inlines an Agent config.
   */
  readonly agentTemplateIdFor: (role: AgentRole) => string;
  /** Default outcome iteration cap when a request doesn't pin one. */
  readonly defaultMaxIterations?: number;
  /** Deterministic clock for emitted event timestamps (tests). */
  readonly now?: () => string;
}

export class CmaRuntime implements LoopAgentRuntime {
  constructor(
    private readonly client: CmaClient,
    private readonly opts: CmaRuntimeOptions,
  ) {}

  // ── startSession ──────────────────────────────────────────────────────────

  async startSession(input: LoopSessionInput): Promise<LoopSession> {
    // Validate the knobs for THIS model BEFORE touching the API — a wrong
    // (model, knob) pairing is a guaranteed 400; fail fast and locally.
    this.assertKnobs(input.modelId, input.effort ?? undefined);

    // Resolve the role to its pre-provisioned Agent template id (created once, by
    // the provisioning script — never inlined here, keeping the path cache-shaped).
    const agentTemplateId = this.opts.agentTemplateIdFor(input.role);
    await this.client.getAgent(agentTemplateId);

    const session = await this.client.createSession({
      agentTemplateId,
      loopId: input.loopId,
      runId: input.runId,
      workspaceDir: input.workspaceDir,
    });

    const handle: CmaLoopSession = {
      sessionId: session.id,
      cmaSessionId: session.id,
      loopId: input.loopId,
      runId: input.runId,
      cycle: input.cycle,
      role: input.role,
      modelId: input.modelId,
      workspaceDir: input.workspaceDir,
    };
    return handle;
  }

  // ── executePhase ──────────────────────────────────────────────────────────

  async executePhase(
    session: LoopSession,
    req: PhaseRequest,
    emit: EventSink,
  ): Promise<PhaseResult> {
    const cmaSessionId = this.cmaId(session);
    const normalizer = new CmaSseNormalizer({
      loopId: session.loopId,
      runId: session.runId,
      modelId: session.modelId,
      agentId: `agt-${session.role}`,
      phase: req.phase,
      ...(this.opts.now ? { now: this.opts.now } : {}),
    });

    // Stream-first: open the SSE stream BEFORE sending the instruction so no early
    // frame is missed.
    const stream = this.client.streamEvents(cmaSessionId);

    // The volatile per-tick instruction goes in as a mid-conversation role:"system"
    // message — it does NOT edit the cached system prefix (prompt-cache discipline).
    const sysMsg: CmaSystemMessageEvent = {
      type: 'system.message',
      content: [{ type: 'text', text: composeInstruction(req) }],
    };
    await this.client.sendEvents(cmaSessionId, [sysMsg]);

    const changed = new Set<string>();
    let summary = '';
    let memoryNote: string | undefined;
    let usage = emptyUsage();

    for await (const frame of stream) {
      // Track artifact writes from tool_use frames so the engine can snapshot the diff.
      collectChangedFiles(frame, changed);
      summary = takeSummary(frame, summary);
      memoryNote = takeMemoryNote(frame, memoryNote);
      usage = accumulateUsage(frame, usage);

      for (const e of normalizer.normalize(frame)) emit(e);

      if (isTurnTerminal(frame)) break;
    }

    return {
      summary: summary || `${req.phase} turn complete`,
      changed: [...changed],
      ...(memoryNote !== undefined ? { memoryNote } : {}),
      usage,
    };
  }

  // ── evaluate (independent grader via user.define_outcome) ────────────────────

  async evaluate(
    session: LoopSession,
    req: EvaluateRequest,
    emit: EventSink,
  ): Promise<OutcomeVerdict> {
    const cmaSessionId = this.cmaId(session);
    const normalizer = new CmaSseNormalizer({
      loopId: session.loopId,
      runId: session.runId,
      modelId: session.modelId,
      agentId: 'agt-reviewer',
      phase: 'evaluate',
      ...(this.opts.now ? { now: this.opts.now } : {}),
    });

    const stream = this.client.streamEvents(cmaSessionId);

    const maxIterations = req.maxIterations || this.opts.defaultMaxIterations || 3;
    const outcome: CmaDefineOutcomeEvent = {
      type: 'user.define_outcome',
      description: `Independently grade: ${req.targetSummary}. Score artifacts/diffs in ${req.workspaceDir}, not claims.`,
      rubric: { type: 'text', content: renderRubric(req.rubric) },
      max_iterations: maxIterations,
    };
    await this.client.sendEvents(cmaSessionId, [outcome]);

    let result: OutcomeResult = 'failed';
    let iterations = 0;
    const gates: GateVerdict[] = [];
    let usage = emptyUsage();
    let sawTerminal = false;

    for await (const frame of stream) {
      usage = accumulateUsage(frame, usage);
      for (const e of normalizer.normalize(frame)) emit(e);

      if (frame.type === 'span.outcome_evaluation_end') {
        iterations = numberOr(frame.iteration, iterations);
        const mapped = mapOutcomeResult(frame.result);
        if (mapped !== undefined) result = mapped;
        recordGates(gates, frame, mapped);
        // evaluate() is contractually ONE grading pass: any settled outcome end
        // terminates the turn — including `needs_revision`, which drives the engine's
        // IMPROVE rework loop. (isOutcomeTerminal excludes needs_revision, so relying
        // on it alone would hang the stream on the most common rework verdict.)
        sawTerminal = true;
      }

      // The grading loop ends once an outcome settled and the session goes idle
      // (poll-before-settle on the terminal transition).
      if (sawTerminal && isTurnTerminal(frame)) break;
    }

    // If the grader never scored individual gates, derive a verdict from the result.
    if (gates.length === 0) {
      for (const category of RUBRIC_CATEGORIES) {
        const passed = result === 'satisfied';
        gates.push({
          category,
          passed,
          score: passed ? 90 : 60,
          notes: passed ? 'Meets the rubric.' : `Outcome: ${result}.`,
        });
      }
    }

    return { result, iterations, gates, usage };
  }

  // ── endSession ───────────────────────────────────────────────────────────

  async endSession(session: LoopSession): Promise<void> {
    await this.client.archiveSession(this.cmaId(session));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private cmaId(session: LoopSession): string {
    return (session as CmaLoopSession).cmaSessionId ?? session.sessionId;
  }

  /**
   * Throw if the (model, effort) pairing is illegal per the tier policy. Applies the
   * corrected knobs: adaptive thinking on Opus/Sonnet (always-on, omitted, on Fable),
   * effort omitted on Haiku, xhigh only Opus-4.7+/Fable, no sampling on Opus/Fable.
   */
  private assertKnobs(modelId: ModelId, effort: string | undefined): void {
    const tier = getTier(modelId);
    const knobs: ModelKnobs = {
      // Adaptive thinking is sent on every model that supports it EXCEPT Fable, whose
      // thinking param must be omitted entirely (always-on).
      adaptiveThinking: tier.supportsAdaptiveThinking && !tier.omitThinkingParam,
      // We never send sampling params on any model in this runtime.
      sampling: false,
      // Pin the effort rung only when the caller supplied one (Haiku omits it).
      ...(effort !== undefined && effort !== null ? { effort: effort as Effort } : {}),
    };
    const violations = validateKnobs(modelId, knobs);
    if (violations.length > 0) {
      throw new Error(
        `CmaRuntime: illegal model knobs for ${modelId} (would 400): ${violations.join(' ')}`,
      );
    }
  }
}

// ─── pure helpers (frame interpretation) ───────────────────────────────────────

function composeInstruction(req: PhaseRequest): string {
  const rework = req.iteration > 0 ? ` (rework pass #${req.iteration})` : '';
  return `Phase: ${req.phase.toUpperCase()}${rework}\n\n${req.instruction}\n\n--- context ---\n${req.context}`;
}

function renderRubric(rubric: Record<RubricCategory, string>): string {
  let out = '# Evaluation rubric\n\nGrade each gate independently against the artifact diff.\n';
  for (const category of RUBRIC_CATEGORIES) {
    out += `\n## ${category}\n${rubric[category]}\n`;
  }
  return out;
}

const OUTCOME_RESULT_MAP: Readonly<Record<string, OutcomeResult>> = {
  satisfied: 'satisfied',
  needs_revision: 'needs_revision',
  max_iterations_reached: 'max_iterations_reached',
  failed: 'failed',
};

function mapOutcomeResult(result: string | undefined): OutcomeResult | undefined {
  if (typeof result !== 'string') return undefined;
  return OUTCOME_RESULT_MAP[result];
}

function recordGates(
  gates: GateVerdict[],
  frame: RawCmaFrame,
  result: OutcomeResult | undefined,
): void {
  // CMA's outcome grader returns a single verdict + explanation per iteration; we keep
  // the latest iteration's verdict and reflect it across the four gate categories. (The
  // full per-gate breakdown lands with the Phase 3 normalizer.)
  gates.length = 0;
  const satisfied = result === 'satisfied';
  const explanation = typeof frame.explanation === 'string' ? frame.explanation : '';
  for (const category of RUBRIC_CATEGORIES) {
    gates.push({
      category,
      passed: satisfied,
      score: satisfied ? 90 : 60,
      notes: explanation || (satisfied ? 'Meets the rubric.' : `Outcome: ${result ?? 'unknown'}.`),
    });
  }
}

/** Tool-use frames that wrote files contribute to the artifact-snapshot change set. */
function collectChangedFiles(frame: RawCmaFrame, into: Set<string>): void {
  if (frame.type !== 'agent.tool_use') return;
  const tool = frame.name;
  if (tool !== 'write' && tool !== 'edit') return;
  const input = frame.input;
  if (!input) return;
  const path = input['path'] ?? input['file_path'];
  if (typeof path === 'string' && path.length > 0) into.add(path);
}

/** First agent.message text becomes the turn summary if none set yet. */
function takeSummary(frame: RawCmaFrame, current: string): string {
  if (current.length > 0) return current;
  if (frame.type !== 'agent.message' || !Array.isArray(frame.content)) return current;
  let text = '';
  for (const b of frame.content) if (b && typeof b.text === 'string') text += b.text;
  return text.trim().slice(0, 280);
}

/** A custom `memory.note` tool call surfaces a distilled insight to persist. */
function takeMemoryNote(frame: RawCmaFrame, current: string | undefined): string | undefined {
  if (current !== undefined) return current;
  if (frame.type !== 'agent.tool_use' && frame.type !== 'agent.custom_tool_use') return current;
  if (frame.name !== 'memory.note' && frame.name !== 'memory_note') return current;
  const note = frame.input?.['summary'] ?? frame.input?.['note'];
  return typeof note === 'string' && note.length > 0 ? note : current;
}

function accumulateUsage(frame: RawCmaFrame, acc: TokenUsage): TokenUsage {
  // Inference usage rides on `span.model_request_end.model_usage`; the grader's
  // per-iteration usage rides on `span.outcome_evaluation_end.usage` (same shape).
  const mu =
    frame.type === 'span.model_request_end'
      ? frame.model_usage
      : frame.type === 'span.outcome_evaluation_end'
        ? frame.usage
        : undefined;
  if (!mu) return acc;
  return {
    inputTokens: acc.inputTokens + numberOr(mu.input_tokens, 0),
    outputTokens: acc.outputTokens + numberOr(mu.output_tokens, 0),
    cacheReadInputTokens: acc.cacheReadInputTokens + numberOr(mu.cache_read_input_tokens, 0),
    cacheCreationInputTokens:
      acc.cacheCreationInputTokens + numberOr(mu.cache_creation_input_tokens, 0),
  };
}

/** True when the session settled (idle with a terminal stop, or terminated). */
function isTurnTerminal(frame: RawCmaFrame): boolean {
  if (frame.type === 'session.status_terminated') return true;
  if (frame.type === 'session.status_idle') {
    const stop = frame.stop_reason?.type;
    // `requires_action` means it's waiting on us — not terminal.
    return stop !== 'requires_action';
  }
  return false;
}

/** True when the outcome reached a terminal grader verdict. */
function isOutcomeTerminal(frame: RawCmaFrame): boolean {
  if (frame.type !== 'span.outcome_evaluation_end') return false;
  const r = frame.result;
  return r === 'satisfied' || r === 'max_iterations_reached' || r === 'failed' || r === 'interrupted';
}

function numberOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
