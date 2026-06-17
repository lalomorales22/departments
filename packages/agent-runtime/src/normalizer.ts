/**
 * CmaSseNormalizer — the PARTIAL Phase 2 slice of CMA-SSE → {@link DeptEvent}.
 *
 * The orchestration engine consumes the frozen {@link DeptEvent} protocol; CMA emits
 * its own SSE frames (`agent.message`, `span.model_request_end`, …). This class is the
 * single place those provider shapes are interpreted, satisfying the
 * {@link CmaEventNormalizer} contract frozen in `@departments/events`.
 *
 * Scope (Phase 2 / TASKS.md "Partial CMA-SSE→Event normalizer slice"):
 *   agent.message / agent.thinking            → output / log
 *   agent.tool_use / agent.mcp_tool_use       → tool_use (DEBUG-tab compact summary)
 *   session.status_* / *.thread_status_*      → status
 *   span.model_request_end                    → metric (cost + token usage)
 *   span.outcome_evaluation_*                  → status (EVALUATE pipeline progress)
 *   session.error                             → error
 * Exotic frames are intentionally left UNMAPPED (return []) — Phase 3 finishes the set.
 *
 * `seq` here is PROVISIONAL: the engine reassigns a global monotonic per-loop `seq`
 * (the `(loopId, seq)` resume cursor lives upstream). `id` is stable per logical event
 * for dedupe across reconnects/replays.
 */
import type {
  CmaEventNormalizer,
  DeptEvent,
  LogLevel,
} from '@departments/events';
import type { AgentStatus, GoodDirection, LoopStatus, Phase } from '@departments/shared';

// ─── The minimal raw CMA SSE frame shape we read ──────────────────────────────

/**
 * A CMA SSE frame as it arrives off the wire. We keep this deliberately loose (the
 * wire shape is the provider's, not ours) and read only the fields each mapping needs,
 * guarding every access. Unknown frames fall through to `[]`.
 */
export interface RawCmaFrame {
  readonly type?: string;
  readonly id?: string;
  /** ISO-8601 process time CMA stamps on each event. */
  readonly processed_at?: string | null;
  /** agent.message / agent.thinking content blocks. */
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
  /** agent.tool_use / agent.mcp_tool_use. */
  readonly name?: string;
  readonly input?: Record<string, unknown>;
  /** multiagent thread frames carry the originating agent's name. */
  readonly agent_name?: string;
  readonly session_thread_id?: string;
  /** span.model_request_end usage block. */
  readonly model_usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
  /** span.outcome_evaluation_end per-iteration grader usage (same field shape). */
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
  readonly is_error?: boolean;
  /** tool_use / tool_result correlation id. */
  readonly tool_use_id?: string;
  /** span.outcome_evaluation_* fields. */
  readonly outcome_id?: string;
  readonly iteration?: number;
  readonly result?: string;
  readonly explanation?: string;
  /** span.outcome_evaluation_end per-gate verdicts (when the grader reports them). */
  readonly gates?: ReadonlyArray<{
    readonly category?: string;
    readonly passed?: boolean;
    readonly score?: number;
  }>;
  /** session.status_idle stop reason. */
  readonly stop_reason?: { readonly type?: string };
  /** session.error. */
  readonly error?: { readonly message?: string; readonly type?: string };
}

/** Context the engine supplies so emitted events carry loop/run scoping. */
export interface NormalizerContext {
  readonly loopId: string;
  readonly runId: string;
  /** The model bound to this session — prices the cost metric correctly (not Opus-by-default). */
  readonly modelId?: string;
  /** The agent id this session embodies (e.g. `agt-planner`) — used as a fallback. */
  readonly agentId: string;
  /** The phase this turn is running, for status payloads on pipeline transitions. */
  readonly phase: Phase;
  /**
   * Wall-clock source for the emitted `ts`. Injectable so tests are deterministic;
   * defaults to `new Date().toISOString()` when omitted.
   */
  readonly now?: () => string;
}

// ─── Pricing (USD per 1M tokens) — mirrors the model-tier table ────────────────

interface Price {
  readonly inPerM: number;
  readonly outPerM: number;
}
const PRICES: Readonly<Record<string, Price>> = {
  'claude-opus-4-8': { inPerM: 5, outPerM: 25 },
  'claude-fable-5': { inPerM: 10, outPerM: 50 },
  'claude-sonnet-4-6': { inPerM: 3, outPerM: 15 },
  'claude-haiku-4-5': { inPerM: 1, outPerM: 5 },
};

/** Cache reads bill at ~0.1× the base input rate; writes at ~1.25×. */
function estimateCostUsd(modelId: string | undefined, u: {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}): number {
  const price = (modelId && PRICES[modelId]) || PRICES['claude-opus-4-8']!;
  const perM = (n: number, rate: number): number => (n / 1_000_000) * rate;
  return (
    perM(u.input, price.inPerM) +
    perM(u.output, price.outPerM) +
    perM(u.cacheRead, price.inPerM * 0.1) +
    perM(u.cacheCreate, price.inPerM * 1.25)
  );
}

// ─── Status mapping tables ─────────────────────────────────────────────────────

const SESSION_STATUS: Readonly<Record<string, LoopStatus>> = {
  'session.status_running': 'running',
  'session.status_idle': 'idle',
  'session.status_rescheduled': 'running',
  'session.status_terminated': 'stopped',
};

const THREAD_STATUS: Readonly<Record<string, AgentStatus>> = {
  'session.thread_status_running': 'running',
  'session.thread_status_idle': 'idle',
  'session.thread_status_rescheduled': 'running',
  'session.thread_status_terminated': 'idle',
};

export class CmaSseNormalizer implements CmaEventNormalizer {
  private seq = 0;

  constructor(private readonly ctx: NormalizerContext) {}

  /** Map one raw CMA SSE frame to zero-or-more provisional DeptEvents. */
  normalize(raw: unknown): DeptEvent[] {
    if (raw === null || typeof raw !== 'object') return [];
    const f = raw as RawCmaFrame;
    const type = f.type;
    if (typeof type !== 'string') return [];

    switch (type) {
      case 'agent.message':
        return this.fromMessage(f, { thinking: false, streaming: false });
      case 'agent.message_delta':
        // Streamed token delta — coalesced on the client (OutputPayload.streaming).
        return this.fromMessage(f, { thinking: false, streaming: true });
      case 'agent.thinking':
        return this.fromMessage(f, { thinking: true, streaming: false });
      case 'agent.tool_use':
        return this.fromToolUse(f, '', 'start');
      case 'agent.mcp_tool_use':
        return this.fromToolUse(f, 'mcp:', 'start');
      case 'agent.custom_tool_use':
      case 'agent.server_tool_use':
        return this.fromToolUse(f, 'tool:', 'start');
      case 'agent.tool_result':
      case 'agent.mcp_tool_result':
      case 'agent.custom_tool_result':
        return this.fromToolResult(f);
      case 'span.model_request_end':
        return this.fromModelRequestEnd(f);
      case 'session.error':
        return this.fromError(f);
      default:
        if (type.startsWith('session.status_')) return this.fromSessionStatus(f, type);
        if (type.startsWith('session.thread_status_')) return this.fromThreadStatus(f, type);
        if (type.startsWith('span.outcome_evaluation_')) return this.fromOutcomeEval(f, type);
        // Exotic / not-yet-mapped frame — safely dropped (callers tolerate []).
        return [];
    }
  }

  // ── builders ────────────────────────────────────────────────────────────────

  /** Common base for every emitted event; assigns provisional seq + stable id. */
  private base(kind: DeptEvent['kind'], rawId: string | undefined): Omit<DeptEvent, 'kind' | 'payload'> {
    const provisionalSeq = this.seq++;
    return {
      id: rawId ?? `${this.ctx.runId}:${kind}:${provisionalSeq}`,
      seq: provisionalSeq,
      loopId: this.ctx.loopId,
      runId: this.ctx.runId,
      ts: this.ctx.now ? this.ctx.now() : new Date().toISOString(),
    };
  }

  private textOf(f: RawCmaFrame): string {
    if (!Array.isArray(f.content)) return '';
    let out = '';
    for (const block of f.content) {
      if (block && typeof block.text === 'string') out += block.text;
    }
    return out;
  }

  private agentId(f: RawCmaFrame): string {
    return typeof f.agent_name === 'string' && f.agent_name.length > 0
      ? f.agent_name
      : this.ctx.agentId;
  }

  /** agent.message(_delta) → output; agent.thinking → log (DEBUG-level reasoning trace). */
  private fromMessage(f: RawCmaFrame, opts: { thinking: boolean; streaming: boolean }): DeptEvent[] {
    const text = this.textOf(f);
    if (text.length === 0) return [];
    if (opts.thinking) {
      const level: LogLevel = 'debug';
      return [
        {
          ...this.base('log', f.id),
          kind: 'log',
          payload: { level, source: 'thinking', agentId: this.agentId(f), message: text },
        },
      ];
    }
    return [
      {
        ...this.base('output', f.id),
        kind: 'output',
        payload: { text, agentId: this.agentId(f), streaming: opts.streaming },
      },
    ];
  }

  /** agent.{tool_use,mcp_tool_use,custom_tool_use,server_tool_use} → tool_use start. */
  private fromToolUse(f: RawCmaFrame, prefix: string, phase: 'start' | 'result' | 'error'): DeptEvent[] {
    const tool = typeof f.name === 'string' && f.name.length > 0 ? f.name : 'tool';
    const prefixed = `${prefix}${tool}`;
    const summary = this.summarizeInput(f.input);
    return [
      {
        ...this.base('tool_use', f.id),
        kind: 'tool_use',
        payload: {
          agentId: this.agentId(f),
          tool: prefixed,
          phase,
          summary: `${prefixed}${summary ? ` ${summary}` : ''}`,
          ...(f.input ? { input: f.input } : {}),
        },
      },
    ];
  }

  /** agent.*_tool_result → tool_use with phase result/error (correlates by tool_use_id). */
  private fromToolResult(f: RawCmaFrame): DeptEvent[] {
    const tool = typeof f.name === 'string' && f.name.length > 0 ? f.name : (f.tool_use_id ?? 'tool');
    const errored = f.is_error === true;
    const detail = this.textOf(f);
    return [
      {
        ...this.base('tool_use', f.id),
        kind: 'tool_use',
        payload: {
          agentId: this.agentId(f),
          tool,
          phase: errored ? 'error' : 'result',
          summary: `${tool} → ${errored ? 'error' : 'ok'}${detail ? `: ${truncate(detail, 60)}` : ''}`,
        },
      },
    ];
  }

  private summarizeInput(input: Record<string, unknown> | undefined): string {
    if (!input) return '';
    const keys = Object.keys(input);
    if (keys.length === 0) return '';
    const first = keys[0]!;
    const val = input[first];
    const valStr =
      typeof val === 'string'
        ? val.length > 48
          ? `${val.slice(0, 48)}…`
          : val
        : JSON.stringify(val);
    return `(${first}=${valStr})`;
  }

  /** session.status_* → loop-scoped status; idle settles only on a terminal stop. */
  private fromSessionStatus(f: RawCmaFrame, type: string): DeptEvent[] {
    const loopStatus = SESSION_STATUS[type];
    if (loopStatus === undefined) return [];
    return [
      {
        ...this.base('status', f.id),
        kind: 'status',
        payload: {
          scope: 'loop',
          targetId: this.ctx.loopId,
          loopStatus,
          phase: this.ctx.phase,
        },
      },
    ];
  }

  /** session.thread_status_* → agent-scoped status (multiagent subagent threads). */
  private fromThreadStatus(f: RawCmaFrame, type: string): DeptEvent[] {
    const agentStatus = THREAD_STATUS[type];
    if (agentStatus === undefined) return [];
    const agentId = this.agentId(f);
    return [
      {
        ...this.base('status', f.id),
        kind: 'status',
        payload: { scope: 'agent', targetId: agentId, agentStatus },
      },
    ];
  }

  /** span.model_request_end → cost + token-count metrics for the budget ledger. */
  private fromModelRequestEnd(f: RawCmaFrame): DeptEvent[] {
    const mu = f.model_usage;
    if (!mu) return [];
    const input = numberOr(mu.input_tokens, 0);
    const output = numberOr(mu.output_tokens, 0);
    const cacheRead = numberOr(mu.cache_read_input_tokens, 0);
    const cacheCreate = numberOr(mu.cache_creation_input_tokens, 0);
    const totalTokens = input + output + cacheRead + cacheCreate;
    const costUsd = estimateCostUsd(this.ctx.modelId, { input, output, cacheRead, cacheCreate });
    const up: GoodDirection = 'up';
    const down: GoodDirection = 'down';

    const tokenEvent: DeptEvent = {
      ...this.base('metric', f.id ? `${f.id}:tokens` : undefined),
      kind: 'metric',
      payload: {
        key: 'tokens',
        name: 'Tokens',
        value: totalTokens,
        display: `${totalTokens.toLocaleString('en-US')} tok`,
        delta: output,
        goodDirection: down,
        unit: 'tokens',
      },
    };
    const cacheReadEvent: DeptEvent = {
      ...this.base('metric', f.id ? `${f.id}:cache_read` : undefined),
      kind: 'metric',
      payload: {
        key: 'cache_read_input_tokens',
        name: 'Cache Reads',
        value: cacheRead,
        display: `${cacheRead.toLocaleString('en-US')} tok`,
        delta: cacheRead,
        goodDirection: up,
        unit: 'tokens',
      },
    };
    const costEvent: DeptEvent = {
      ...this.base('metric', f.id ? `${f.id}:cost` : undefined),
      kind: 'metric',
      payload: {
        key: 'cost_usd',
        name: 'Cost',
        value: Number(costUsd.toFixed(6)),
        display: `$${costUsd.toFixed(4)}`,
        delta: Number(costUsd.toFixed(6)),
        goodDirection: down,
        unit: 'usd',
      },
    };
    return [tokenEvent, cacheReadEvent, costEvent];
  }

  /**
   * span.outcome_evaluation_* → status (EVALUATE pipeline progress). The grader's
   * verdict (`result`) is surfaced as a log line so the LogConsole shows progress; the
   * structured verdict is mapped to {@link OutcomeVerdict} by {@link CmaRuntime.evaluate}.
   */
  private fromOutcomeEval(f: RawCmaFrame, type: string): DeptEvent[] {
    const events: DeptEvent[] = [];
    // Drive the pipeline into / out of the EVALUATE stage.
    events.push({
      ...this.base('status', f.id),
      kind: 'status',
      payload: { scope: 'loop', targetId: this.ctx.loopId, phase: 'evaluate' },
    });

    if (type === 'span.outcome_evaluation_start') {
      events.push({
        ...this.base('log', f.id ? `${f.id}:log` : undefined),
        kind: 'log',
        payload: {
          level: 'info',
          source: 'grader',
          message: `grader · iteration ${numberOr(f.iteration, 0)} · scoring`,
        },
      });
    } else if (type === 'span.outcome_evaluation_end') {
      const result = typeof f.result === 'string' ? f.result : 'unknown';
      const level: LogLevel = result === 'satisfied' ? 'info' : 'warn';
      const explanation = typeof f.explanation === 'string' ? ` — ${f.explanation}` : '';
      events.push({
        ...this.base('log', f.id ? `${f.id}:log` : undefined),
        kind: 'log',
        payload: {
          level,
          source: 'grader',
          message: `grader · iteration ${numberOr(f.iteration, 0)} · ${result}${explanation}`,
        },
      });
      // Per-gate verdicts (when the grader reports them) → DEBUG lines for the trace.
      if (Array.isArray(f.gates)) {
        for (const g of f.gates) {
          const cat = typeof g.category === 'string' ? g.category : 'gate';
          const passed = g.passed === true;
          events.push({
            ...this.base('debug', f.id ? `${f.id}:gate:${cat}` : undefined),
            kind: 'debug',
            payload: {
              agentId: 'agt-reviewer',
              message: `gate ${cat}: ${passed ? 'PASS' : 'FAIL'}${typeof g.score === 'number' ? ` (${g.score})` : ''}`,
              ...(typeof g.score === 'number' ? { detail: { score: g.score, passed } } : { detail: { passed } }),
            },
          });
        }
      }
    }
    // `_ongoing` is a heartbeat — the status event above is sufficient.
    return events;
  }

  private fromError(f: RawCmaFrame): DeptEvent[] {
    const message =
      f.error && typeof f.error.message === 'string' ? f.error.message : 'session error';
    const code = f.error && typeof f.error.type === 'string' ? f.error.type : undefined;
    return [
      {
        ...this.base('error', f.id),
        kind: 'error',
        payload: { message, ...(code ? { code } : {}) },
      },
    ];
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function numberOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
