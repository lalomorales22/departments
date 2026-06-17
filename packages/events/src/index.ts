/**
 * @departments/events — THE FROZEN EVENT PROTOCOL.
 *
 * This is the binding contract between the CMA event stream, the orchestrator, the
 * realtime spine (Redis Streams → WS), and the cockpit UI. Phases 2–3 implement the
 * normalizer + transport against this shape; it must not churn.
 *
 * Invariants:
 *  - `seq` is MONOTONIC PER LOOP (resume cursor = `(loopId, seq)`).
 *  - `id` is STABLE per logical event (dedupe key across reconnects/replays).
 *  - Terminal/status events MUST always settle on resume even if already seen.
 */
import type { AgentStatus, EventKind, GoodDirection, LoopStatus, Phase } from '@departments/shared';

/** Bump only on a breaking change to the wire shape. */
export const EVENT_PROTOCOL_VERSION = 1 as const;

// ─── Base ─────────────────────────────────────────────────────────────────────

export interface BaseEvent {
  /** Stable per logical event — dedupe key across reconnects/replays. */
  id: string;
  /** Monotonic per loop. The resume cursor is `(loopId, seq)`. */
  seq: number;
  loopId: string;
  /** Run this event belongs to, when applicable. */
  runId?: string;
  /** ISO-8601 emit time. */
  ts: string;
  kind: EventKind;
}

// ─── Per-kind payloads ──────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogPayload {
  level: LogLevel;
  message: string;
  agentId?: string;
  /** Origin tag shown in the console gutter (e.g. "planner", "engine"). */
  source?: string;
}

export interface DebugPayload {
  message: string;
  agentId?: string;
  detail?: Record<string, unknown>;
}

export interface OutputPayload {
  /** A text chunk (may be a streamed token delta — coalesce on the client). */
  text: string;
  agentId?: string;
  streaming?: boolean;
}

export interface AgentMsgPayload {
  agentId: string;
  message: string;
}

export interface ToolUsePayload {
  agentId?: string;
  /** Tool name (e.g. "web_search", "github.commit", "mcp:slack.post"). */
  tool: string;
  phase: 'start' | 'result' | 'error';
  /** Compact one-line summary for the DEBUG tab. */
  summary: string;
  input?: Record<string, unknown>;
}

export interface StatusPayload {
  scope: 'loop' | 'agent' | 'session';
  targetId: string;
  loopStatus?: LoopStatus;
  agentStatus?: AgentStatus;
  /** Engine phase, when this status reflects a pipeline transition. */
  phase?: Phase;
}

export interface MetricPayload {
  key: string;
  name: string;
  value: number;
  display: string;
  delta: number;
  goodDirection: GoodDirection;
  unit?: string;
}

export interface ErrorPayload {
  message: string;
  code?: string;
  agentId?: string;
}

// ─── The discriminated union ──────────────────────────────────────────────────

export type DeptEvent =
  | (BaseEvent & { kind: 'log'; payload: LogPayload })
  | (BaseEvent & { kind: 'debug'; payload: DebugPayload })
  | (BaseEvent & { kind: 'output'; payload: OutputPayload })
  | (BaseEvent & { kind: 'agent_msg'; payload: AgentMsgPayload })
  | (BaseEvent & { kind: 'tool_use'; payload: ToolUsePayload })
  | (BaseEvent & { kind: 'status'; payload: StatusPayload })
  | (BaseEvent & { kind: 'metric'; payload: MetricPayload })
  | (BaseEvent & { kind: 'error'; payload: ErrorPayload });

/** Narrow a DeptEvent to a specific kind. */
export type EventOf<K extends EventKind> = Extract<DeptEvent, { kind: K }>;

// ─── Resume / dedupe ──────────────────────────────────────────────────────────

export interface ResumeCursor {
  loopId: string;
  /** Replay strictly after this seq. */
  lastSeq: number;
}

/** Terminal/status kinds must always settle on resume even if their id was seen. */
export const ALWAYS_SETTLE_KINDS: readonly EventKind[] = ['status', 'metric', 'error'];

export function isAlwaysSettle(e: DeptEvent): boolean {
  return ALWAYS_SETTLE_KINDS.includes(e.kind);
}

// ─── Channel / topic helpers (WS multiplexing) ────────────────────────────────

export type LoopChannel = 'status' | 'pipeline' | 'logs' | 'metrics';

export function loopTopic(loopId: string, channel: LoopChannel): string {
  return `loop:${loopId}:${channel}`;
}
export function agentTopic(agentId: string): string {
  return `agent:${agentId}:status`;
}
export function tasksTopic(loopId: string): string {
  return `tasks:${loopId}`;
}
export const SYSTEM_TOPIC = 'global:system' as const;

/** Redis Stream key for a loop's append-only event log. */
export function loopStreamKey(loopId: string): string {
  return `loop:${loopId}:events`;
}

// ─── Normalizer interface (DEFINED here; IMPLEMENTED in Phase 2/3) ────────────

/**
 * Normalizes raw CMA SSE frames into zero-or-more `DeptEvent`s. The implementation
 * assigns monotonic `seq` per loop and stable `id`s. Defining it here keeps the
 * contract frozen before any implementation exists (so Phase 2's frontend doesn't
 * silently depend on Phase 3's full normalizer).
 */
export interface CmaEventNormalizer {
  /** @param raw a single CMA SSE frame (shape owned by the runtime adapter). */
  normalize(raw: unknown): DeptEvent[];
}
