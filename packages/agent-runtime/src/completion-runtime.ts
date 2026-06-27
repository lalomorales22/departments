/**
 * CompletionLoopRuntime — the shared, provider-agnostic {@link LoopAgentRuntime} skeleton
 * for any chat-completion model (local Ollama or the Claude Messages API).
 *
 * It owns ALL the loop cognition — the per-phase prompts, writing the model's output as
 * real artifacts in the git working tree, streaming `output` events, and the independent
 * four-gate grader in EVALUATE. A concrete provider supplies ONLY three small things:
 *   - `complete()`     — turn (system + messages) into text + token usage (optionally
 *                        streaming deltas for the live terminal);
 *   - `resolveCallModel()`        — the real model name to send to the provider;
 *   - `resolveAccountingModelId()`— the {@link ModelId} the engine bills/tiers against.
 *
 * This is why adding a provider is a ~40-line file, not a fork of the cycle logic.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { DeptEvent } from '@departments/events';
import {
  RUBRIC_CATEGORIES,
  type AgentRole,
  type CyclePhase,
  type RubricCategory,
  type TokenUsage,
} from '@departments/shared';
import type { ModelId } from './models.js';
import {
  emptyUsage,
  type EvaluateRequest,
  type EventSink,
  type GateVerdict,
  type LoopAgentRuntime,
  type LoopSession,
  type LoopSessionInput,
  type OutcomeVerdict,
  type PhaseRequest,
  type PhaseResult,
} from './loop-runtime.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  text: string;
  usage: TokenUsage;
}

interface SessionCtx {
  systemContext: string;
  role: AgentRole;
  callModel: string;
  accountingModelId: ModelId;
}

export abstract class CompletionLoopRuntime implements LoopAgentRuntime {
  protected seq = 0;
  private readonly sessions = new Map<string, SessionCtx>();

  /** Provider completion. `onDelta` (when provided) streams text deltas for the terminal. */
  protected abstract complete(
    callModel: string,
    messages: ChatMessage[],
    onDelta?: (delta: string) => void,
  ): Promise<CompletionResult>;

  /**
   * The real model name to send to the provider for an engine-supplied {@link ModelId} +
   * role. The role lets a provider pick a DIFFERENT model per orchestrator role (e.g. a
   * bigger local model for planner/reviewer judgment, a faster one for executor/docs).
   */
  protected abstract resolveCallModel(modelId: ModelId, role: AgentRole): string;

  /** The {@link ModelId} the engine accounts/tiers against (a sentinel for local). */
  protected abstract resolveAccountingModelId(modelId: ModelId): ModelId;

  /** A short provider tag for log/error lines, e.g. "Ollama" / "Claude". */
  protected abstract readonly providerLabel: string;

  async startSession(input: LoopSessionInput): Promise<LoopSession> {
    const callModel = this.resolveCallModel(input.modelId, input.role);
    const accountingModelId = this.resolveAccountingModelId(input.modelId);
    const sessionId = `${this.providerLabel.toLowerCase()}-${input.loopId}-${input.runId}-${input.role}`;
    this.sessions.set(sessionId, { systemContext: input.systemContext, role: input.role, callModel, accountingModelId });
    return {
      sessionId,
      loopId: input.loopId,
      runId: input.runId,
      cycle: input.cycle,
      role: input.role,
      modelId: accountingModelId,
      workspaceDir: input.workspaceDir,
    };
  }

  async executePhase(s: LoopSession, req: PhaseRequest, emit: EventSink): Promise<PhaseResult> {
    const ctx = this.sessions.get(s.sessionId);
    const systemContext = ctx?.systemContext ?? '';
    const callModel = ctx?.callModel ?? this.resolveCallModel(s.modelId, s.role);
    const agentId = `agt-${s.role}`;
    const e = this.emitter(s, req.phase, emit);

    e.status('running', req.phase);
    e.log('info', `${req.phase.toUpperCase()} · cycle ${s.cycle}${req.iteration > 0 ? ` · rework #${req.iteration}` : ''} · ${callModel}`);

    const prompt = await phasePrompt(s.workspaceDir, s.cycle, req);
    e.agentMsg(agentId, prompt.narration);

    let text: string;
    let usage: TokenUsage;
    const term = this.coalescedOutput(agentId, e);
    try {
      const out = await this.complete(
        callModel,
        [
          { role: 'system', content: `${systemContext}\n\nYou are the ${s.role} agent. Current phase: ${req.phase.toUpperCase()}.` },
          { role: 'user', content: prompt.user },
        ],
        term.onDelta,
      );
      text = out.text.trim();
      usage = out.usage;
    } catch (err) {
      term.flush();
      e.error(`${this.providerLabel} call failed (${callModel}): ${errMsg(err)}.`);
      throw err;
    }
    term.flush(); // emit the tail so short responses aren't dropped from the terminal

    const changed = await writePhaseArtifacts(s.workspaceDir, s.cycle, req, text, callModel, e, agentId);
    e.log('info', `${req.phase.toUpperCase()} done — ${changed.length} artifact(s) changed.`);
    return {
      summary: firstLine(text) || `${req.phase} turn produced ${text.length} chars.`,
      changed,
      memoryNote:
        req.phase === 'memory' ? (extractTagged(text, 'INSIGHT') ?? `Cycle ${s.cycle}: ${firstLine(text)}`) : undefined,
      usage,
    };
  }

  async evaluate(s: LoopSession, req: EvaluateRequest, emit: EventSink): Promise<OutcomeVerdict> {
    const ctx = this.sessions.get(s.sessionId);
    const callModel = ctx?.callModel ?? this.resolveCallModel(s.modelId, s.role);
    const e = this.emitter(s, 'evaluate', emit);
    e.log('info', `EVALUATE · independent grader (${callModel}) · pass ${req.iteration} · ${req.targetSummary}`, 'grader');

    const evidence = await readEvidence(req.workspaceDir);
    const rubricText = RUBRIC_CATEGORIES.map((c) => `- ${c}: ${req.rubric[c] ?? 'meets the standard for this category'}`).join('\n');
    const user =
      `Independently grade the loop's most recent work. You did NOT produce it — score it honestly and do not inflate.\n\n` +
      `WORK UNDER REVIEW: ${req.targetSummary}\n\nRUBRIC (score each 0-100; "pass" iff it clearly meets the bar):\n${rubricText}\n\n` +
      `EVIDENCE (recent artifacts):\n${evidence}\n\n` +
      `Respond with ONLY a JSON object, no prose, of the exact shape:\n` +
      `{${RUBRIC_CATEGORIES.map((c) => `"${c}":{"pass":true,"score":85,"notes":"..."}`).join(',')}}`;

    let parsed: GraderJson | null = null;
    let usage: TokenUsage = emptyUsage();
    try {
      const out = await this.complete(callModel, [
        { role: 'system', content: 'You are an INDEPENDENT, rigorous quality grader for an autonomous work loop. Output strict JSON only.' },
        { role: 'user', content: user },
      ]);
      usage = out.usage;
      parsed = extractJson(out.text);
    } catch (err) {
      e.log('warn', `grader call failed: ${errMsg(err)} — provisional pass.`, 'grader');
    }

    const gates = buildGates(parsed);
    for (const g of gates) e.debug(`gate ${g.category}: ${g.passed ? 'PASS' : 'FAIL'} (${g.score})`, { score: g.score });

    const anyFail = gates.some((g) => !g.passed);
    const result = !anyFail
      ? 'satisfied'
      : req.iteration >= req.maxIterations
        ? 'max_iterations_reached'
        : 'needs_revision';
    e.log(anyFail ? 'warn' : 'info', `outcome: ${result}`, 'grader');
    return { result, iterations: req.iteration, gates, usage };
  }

  async endSession(s: LoopSession): Promise<void> {
    this.sessions.delete(s.sessionId);
  }

  // ── event emission ────────────────────────────────────────────────────────────

  protected emitter(s: LoopSession, phase: CyclePhase, emit: EventSink): Emitter {
    const base = (kind: DeptEvent['kind']) => ({
      id: `${s.runId}-${phase}-${s.role}-${this.seq}`,
      loopId: s.loopId,
      runId: s.runId,
      ts: new Date().toISOString(),
      kind,
    });
    const send = (ev: Omit<DeptEvent, 'seq'>) => emit({ ...ev, seq: this.seq++ } as DeptEvent);
    return {
      status: (loopStatus, ph) => send({ ...base('status'), kind: 'status', payload: { scope: 'loop', targetId: s.loopId, loopStatus, phase: ph } }),
      log: (level, message, source = 'engine') => send({ ...base('log'), kind: 'log', payload: { level, source, message } }),
      agentMsg: (aid, message) => send({ ...base('agent_msg'), kind: 'agent_msg', payload: { agentId: aid, message } }),
      output: (aid, text, streaming) => send({ ...base('output'), kind: 'output', payload: { agentId: aid, text, streaming } }),
      toolUse: (aid, tool, summary) => send({ ...base('tool_use'), kind: 'tool_use', payload: { agentId: aid, tool, phase: 'result', summary } }),
      metric: (key, name, value, display, delta, goodDirection) => send({ ...base('metric'), kind: 'metric', payload: { key, name, value, display, delta, goodDirection } }),
      debug: (message, detail) => send({ ...base('debug'), kind: 'debug', payload: { agentId: `agt-${s.role}`, message, detail } }),
      error: (message) => send({ ...base('error'), kind: 'error', payload: { message, code: this.providerLabel.toUpperCase() } }),
    };
  }

  /**
   * Coalesce token deltas into ~sentence-sized `output` events (avoids flooding seq).
   * `flush()` MUST be called once the stream ends, or the trailing buffer — the whole
   * response for a short turn — is silently dropped from the terminal.
   */
  protected coalescedOutput(agentId: string, e: Emitter): { onDelta: (d: string) => void; flush: () => void } {
    let buf = '';
    const flush = (final = false) => {
      if (buf) {
        e.output(agentId, buf, !final);
        buf = '';
      }
    };
    return {
      onDelta: (d: string) => {
        buf += d;
        if (buf.length >= 80 || /[\n.!?]$/.test(buf)) flush();
      },
      flush: () => flush(true),
    };
  }
}

export interface Emitter {
  status(loopStatus: 'running' | 'idle' | 'paused', phase: CyclePhase): void;
  log(level: 'info' | 'warn' | 'error', message: string, source?: string): void;
  agentMsg(agentId: string, message: string): void;
  output(agentId: string, text: string, streaming: boolean): void;
  toolUse(agentId: string, tool: string, summary: string): void;
  metric(key: string, name: string, value: number, display: string, delta: number, goodDirection: 'up' | 'down'): void;
  debug(message: string, detail?: Record<string, unknown>): void;
  error(message: string): void;
}

// ── Phase cognition (provider-agnostic) ──────────────────────────────────────────

async function phasePrompt(workspaceDir: string, cycle: number, req: PhaseRequest): Promise<{ user: string; narration: string }> {
  const ctxBlock = req.context ? `\n\nContext (prior HANDOFF + retrieved memory):\n${req.context}` : '';
  switch (req.phase) {
    case 'plan': {
      const tasks = await readArtifact(workspaceDir, 'TASKS.md');
      return {
        narration: 'Reading HANDOFF + memory; refreshing TASKS.md and STRATEGY.md.',
        user:
          `${req.instruction}${ctxBlock}\n\nCurrent TASKS.md:\n${tasks || '(empty)'}\n\n` +
          `Produce a SHORT, prioritized task list for THIS cycle as markdown checkboxes (\`- [ ] ...\`), concrete to the ` +
          `mission. Then a final line exactly: "STRATEGY: <one or two sentences>".`,
      };
    }
    case 'execute':
      return {
        narration: req.iteration > 0 ? 'Reworking to satisfy the failing gate(s).' : 'Implementing the top task; producing real output.',
        user:
          `${req.instruction}${ctxBlock}\n\nDo the actual work for the highest-priority open task now. Produce the real ` +
          `work product as markdown (use fenced code blocks for any code). Be concrete and complete — this is the artifact itself.`,
      };
    case 'improve':
      return {
        narration: 'Distilling learnings; writing REPORT.md and reprioritizing the backlog.',
        user: `${req.instruction}${ctxBlock}\n\nDistill this cycle's key learnings and the concrete optimizations to apply next, as concise markdown bullets.`,
      };
    case 'memory':
      return {
        narration: 'Writing HANDOFF.md and distilling one durable insight to memory.',
        user:
          `${req.instruction}${ctxBlock}\n\nWrite the HANDOFF.md for the NEXT cycle (≤ ~12 lines): current status, key decisions, and the ` +
          `single most important next step. Then a final line exactly: "INSIGHT: <one durable, reusable insight>".`,
      };
    default:
      return { narration: `Running ${req.phase}.`, user: `${req.instruction}${ctxBlock}` };
  }
}

async function writePhaseArtifacts(
  workspaceDir: string,
  cycle: number,
  req: PhaseRequest,
  text: string,
  callModel: string,
  e: Emitter,
  agentId: string,
): Promise<string[]> {
  const changed: string[] = [];
  const body = text || `_(the model returned no content for ${req.phase} this cycle)_`;
  switch (req.phase) {
    case 'plan': {
      const strategy = extractTagged(text, 'STRATEGY') ?? firstLine(text);
      await appendArtifact(workspaceDir, 'TASKS.md', `\n## Cycle ${cycle}\n${stripTagged(body, 'STRATEGY')}\n`);
      await writeArtifact(workspaceDir, 'STRATEGY.md', `# STRATEGY (cycle ${cycle})\n\n${strategy}\n`);
      changed.push('TASKS.md', 'STRATEGY.md');
      break;
    }
    case 'execute': {
      const rel = `work/cycle-${cycle}${req.iteration > 0 ? `-rework${req.iteration}` : ''}.md`;
      await writeArtifact(workspaceDir, rel, `# ${callModel} · cycle ${cycle}${req.iteration > 0 ? ` · rework ${req.iteration}` : ''}\n\n${body}\n`);
      changed.push(rel);
      e.toolUse(agentId, 'fs.write', `${rel} (+${body.split('\n').length} lines)`);
      const produced = body.length;
      e.metric('output_chars', 'Output', produced, `${produced}`, produced, 'up');
      break;
    }
    case 'improve':
      await appendArtifact(workspaceDir, 'REPORT.md', `\n## Cycle ${cycle}\n${body}\n`);
      changed.push('REPORT.md');
      break;
    case 'memory': {
      const handoff = stripTagged(body, 'INSIGHT');
      await writeArtifact(workspaceDir, 'HANDOFF.md', handoff.startsWith('#') ? handoff : `# HANDOFF\n\n${handoff}\n`);
      changed.push('HANDOFF.md');
      e.log('info', 'distilled 1 insight → memory store', 'memory');
      break;
    }
  }
  return changed;
}

type GraderJson = Record<string, { pass?: boolean; score?: number; notes?: string }>;

function buildGates(parsed: GraderJson | null): GateVerdict[] {
  return RUBRIC_CATEGORIES.map((category: RubricCategory) => {
    const g = parsed?.[category];
    // Robust against weak local models: default to a provisional pass so a flaky grader
    // never deadlocks the cycle, but honor an explicit fail / low score when given.
    const score = clampScore(g?.score, 78);
    const passed = g?.pass !== undefined ? Boolean(g.pass) : score >= 60;
    return {
      category,
      passed,
      score,
      notes: (g?.notes ?? (parsed ? 'No note returned.' : 'Grader output unparseable — provisional pass.')).slice(0, 240),
    };
  });
}

// ── text helpers ─────────────────────────────────────────────────────────────────

export function firstLine(s: string): string {
  return (s.split('\n').find((l) => l.trim().length > 0) ?? '').trim().slice(0, 200);
}
export function extractTagged(s: string, tag: string): string | undefined {
  const m = s.match(new RegExp(`^\\s*${tag}\\s*:\\s*(.+)$`, 'im'));
  return m?.[1]?.trim();
}
export function stripTagged(s: string, tag: string): string {
  return s.replace(new RegExp(`^\\s*${tag}\\s*:.*$`, 'im'), '').trim();
}
function clampScore(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(0, Math.min(100, Math.round(n)));
}
export function extractJson(s: string): GraderJson | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1)) as GraderJson;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── artifact IO ────────────────────────────────────────────────────────────────

async function writeArtifact(workspaceDir: string, rel: string, content: string): Promise<void> {
  const abs = join(workspaceDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
}
async function appendArtifact(workspaceDir: string, rel: string, content: string): Promise<void> {
  const abs = join(workspaceDir, rel);
  await mkdir(dirname(abs), { recursive: true });
  const prev = await readArtifact(workspaceDir, rel);
  await writeFile(abs, prev ? prev + content : content.replace(/^\n/, ''), 'utf8');
}
async function readArtifact(workspaceDir: string, rel: string): Promise<string> {
  try {
    return await readFile(join(workspaceDir, rel), 'utf8');
  } catch {
    return '';
  }
}
async function readEvidence(workspaceDir: string): Promise<string> {
  const files = ['TASKS.md', 'STRATEGY.md', 'REPORT.md', 'HANDOFF.md'];
  const parts: string[] = [];
  for (const f of files) {
    const c = await readArtifact(workspaceDir, f);
    if (c) parts.push(`--- ${f} ---\n${c.slice(-1200)}`);
  }
  return parts.join('\n\n').slice(0, 6000) || '(no artifacts written yet)';
}
