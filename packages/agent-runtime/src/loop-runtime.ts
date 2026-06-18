/**
 * The ENGINE-FACING runtime contract.
 *
 * `runtime.ts` is the low-level provider primitive (CMA `sessions`/`outcomes`). This
 * is the higher-level, cycle-oriented interface the orchestration engine actually
 * drives: start a session, execute a phase turn (streaming events, producing artifact
 * changes), grade independently, end the session. Both `FakeCmaRuntime` (local,
 * deterministic) and `CmaRuntime` (real, gated behind creds) implement THIS, so the
 * CMA-vs-self-hosted choice stays a deployment detail.
 */
import type { DeptEvent } from '@departments/events';
import type {
  AgentRole,
  CyclePhase,
  OutcomeResult,
  RubricCategory,
  TokenUsage,
} from '@departments/shared';
import type { ModelId } from './models.js';

/** Everything needed to provision a run for one role. */
export interface LoopSessionInput {
  loopId: string;
  runId: string;
  /** The cycle (tick) number — lets runtimes simulate prompt-cache warmth on cycle > 1. */
  cycle: number;
  role: AgentRole;
  modelId: ModelId;
  /** Effort knob; null/undefined for Haiku workers (the param errors there). */
  effort?: string | null;
  /** Absolute path to the loop's git working tree; the agent reads/writes files here. */
  workspaceDir: string;
  /** Frozen, cache-shaped system/context prefix (the stable cached prologue). */
  systemContext: string;
}

export interface LoopSession {
  sessionId: string;
  loopId: string;
  runId: string;
  cycle: number;
  role: AgentRole;
  modelId: ModelId;
  /** The git working tree the agent reads/writes (carried from the session input). */
  workspaceDir: string;
}

/**
 * A request to use a tool that needs human-in-the-loop confirmation. The runtime
 * raises this for an irreversible action (deploy/send/spend/delete); the ENGINE owns
 * the `always_ask` policy + routing and answers with a {@link ToolConfirmResult}.
 */
export interface ToolConfirmInput {
  /** Tool name the agent wants to use, e.g. 'github.deploy', 'email.send'. */
  tool: string;
  /** One-line human summary of the intended action. */
  summary: string;
  input?: Record<string, unknown>;
  agentId?: string;
}

/** The engine's verdict on a {@link ToolConfirmInput}; a denial carries a reason. */
export interface ToolConfirmResult {
  allow: boolean;
  /** Why it was denied — handed back so the agent can reroute work. */
  reason?: string;
}

/**
 * Callback a runtime may invoke before an irreversible tool use to obtain
 * confirmation from the engine's `always_ask` gate. Reversible tools must NOT call
 * it. Absent ⇒ the engine isn't gating tools (auto-approve, legacy behavior).
 */
export type ToolConfirm = (req: ToolConfirmInput) => Promise<ToolConfirmResult>;

/** One phase turn. `iteration` > 0 means a rework pass inside IMPROVE. */
export interface PhaseRequest {
  phase: CyclePhase;
  /** Volatile per-tick instruction (injected mid-conversation as role:"system"). */
  instruction: string;
  /** Prior HANDOFF + retrieved memory + relevant context for this turn. */
  context: string;
  iteration: number;
  /** Engine-provided `always_ask` confirmation hook for irreversible tools (optional). */
  confirm?: ToolConfirm;
}

export interface PhaseResult {
  /** Short agent-authored summary of what the turn did. */
  summary: string;
  /** Workspace-relative paths the turn created or changed (drives the artifact snapshot). */
  changed: string[];
  /** A distilled insight to persist to memory (MEMORY phase typically sets this). */
  memoryNote?: string;
  usage: TokenUsage;
}

export interface EvaluateRequest {
  /** Gradeable criteria markdown per gate category. */
  rubric: Record<RubricCategory, string>;
  /** Cap on the iterate→grade→revise loop. */
  maxIterations: number;
  iteration: number;
  /** Summary of the work under review. */
  targetSummary: string;
  /** Working tree to inspect (the grader scores artifacts/diffs, not claims). */
  workspaceDir: string;
}

export interface GateVerdict {
  category: RubricCategory;
  passed: boolean;
  /** 0–100. */
  score: number;
  notes: string;
}

export interface OutcomeVerdict {
  result: OutcomeResult;
  iterations: number;
  gates: GateVerdict[];
  usage: TokenUsage;
}

/** The engine stamps global per-loop `seq`; runtimes emit provisional events. */
export type EventSink = (event: DeptEvent) => void;

export interface LoopAgentRuntime {
  /** Provision a run (provider session + artifact substrate). */
  startSession(input: LoopSessionInput): Promise<LoopSession>;
  /** Run one phase turn; stream events via `emit`; resolve with the structured result. */
  executePhase(session: LoopSession, req: PhaseRequest, emit: EventSink): Promise<PhaseResult>;
  /** Independent grading (EVALUATE) — runs as its own role so there is no self-grading. */
  evaluate(session: LoopSession, req: EvaluateRequest, emit: EventSink): Promise<OutcomeVerdict>;
  /** Tear down the session (archive container). */
  endSession(session: LoopSession): Promise<void>;
}

/** A no-cost usage record (cache reads dominate on warm cycles). */
export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
}
