import { describe, expect, it } from 'vitest';
import { CmaSseNormalizer, type NormalizerContext } from './normalizer.js';

const ctx: NormalizerContext = {
  loopId: 'mkt',
  runId: 'run-mkt-c1',
  modelId: 'claude-sonnet-4-6',
  agentId: 'agt-executor',
  phase: 'execute',
  now: () => '2026-06-17T00:00:00Z',
};

function norm() {
  return new CmaSseNormalizer(ctx);
}

describe('CmaSseNormalizer — frame coverage', () => {
  it('agent.message → output (non-streaming); agent.message_delta → streaming output', () => {
    const n = norm();
    const a = n.normalize({ type: 'agent.message', content: [{ type: 'text', text: 'hi' }] });
    expect(a[0]?.kind).toBe('output');
    expect(a[0]?.kind === 'output' && a[0].payload.streaming).toBe(false);
    const b = n.normalize({ type: 'agent.message_delta', content: [{ text: 'tok' }] });
    expect(b[0]?.kind === 'output' && b[0].payload.streaming).toBe(true);
  });

  it('agent.thinking → debug-level log on the thinking source', () => {
    const out = norm().normalize({ type: 'agent.thinking', content: [{ text: 'reasoning' }] });
    expect(out[0]?.kind).toBe('log');
    expect(out[0]?.kind === 'log' && out[0].payload.level).toBe('debug');
    expect(out[0]?.kind === 'log' && out[0].payload.source).toBe('thinking');
  });

  it('tool_use variants map to tool_use start with the right prefix', () => {
    const native = norm().normalize({ type: 'agent.tool_use', name: 'fs.write', input: { path: 'a.ts' } });
    expect(native[0]?.kind === 'tool_use' && native[0].payload.tool).toBe('fs.write');
    expect(native[0]?.kind === 'tool_use' && native[0].payload.phase).toBe('start');
    const mcp = norm().normalize({ type: 'agent.mcp_tool_use', name: 'slack.post' });
    expect(mcp[0]?.kind === 'tool_use' && mcp[0].payload.tool).toBe('mcp:slack.post');
    const custom = norm().normalize({ type: 'agent.custom_tool_use', name: 'deploy' });
    expect(custom[0]?.kind === 'tool_use' && custom[0].payload.tool).toBe('tool:deploy');
  });

  it('tool_result maps to tool_use phase result / error', () => {
    const ok = norm().normalize({ type: 'agent.tool_result', name: 'fs.write', content: [{ text: 'wrote 12 lines' }] });
    expect(ok[0]?.kind === 'tool_use' && ok[0].payload.phase).toBe('result');
    const err = norm().normalize({ type: 'agent.mcp_tool_result', name: 'slack.post', is_error: true });
    expect(err[0]?.kind === 'tool_use' && err[0].payload.phase).toBe('error');
  });

  it('span.model_request_end → token + cache + cost metrics', () => {
    const out = norm().normalize({
      type: 'span.model_request_end',
      model_usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000 },
    });
    const keys = out.map((e) => (e.kind === 'metric' ? e.payload.key : ''));
    expect(keys).toEqual(['tokens', 'cache_read_input_tokens', 'cost_usd']);
  });

  it('session.status_* → loop status; thread_status_* → agent status', () => {
    const loop = norm().normalize({ type: 'session.status_running' });
    expect(loop[0]?.kind === 'status' && loop[0].payload.loopStatus).toBe('running');
    const thread = norm().normalize({ type: 'session.thread_status_idle', agent_name: 'agt-qa' });
    expect(thread[0]?.kind === 'status' && thread[0].payload.agentStatus).toBe('idle');
    expect(thread[0]?.kind === 'status' && thread[0].payload.targetId).toBe('agt-qa');
  });

  it('span.outcome_evaluation_end emits pipeline status + grader log + per-gate debug', () => {
    const out = norm().normalize({
      type: 'span.outcome_evaluation_end',
      iteration: 1,
      result: 'needs_revision',
      gates: [
        { category: 'quality', passed: true, score: 92 },
        { category: 'performance', passed: false, score: 61 },
      ],
    });
    expect(out.some((e) => e.kind === 'status' && e.payload.phase === 'evaluate')).toBe(true);
    const gateDebug = out.filter((e) => e.kind === 'debug');
    expect(gateDebug).toHaveLength(2);
    expect(gateDebug.some((e) => e.kind === 'debug' && e.payload.message.includes('performance: FAIL'))).toBe(true);
  });

  it('session.error → error; unknown frames are dropped', () => {
    const err = norm().normalize({ type: 'session.error', error: { message: 'boom', type: 'overloaded' } });
    expect(err[0]?.kind === 'error' && err[0].payload.code).toBe('overloaded');
    expect(norm().normalize({ type: 'agent.compaction_started' })).toEqual([]);
    expect(norm().normalize(null)).toEqual([]);
    expect(norm().normalize({})).toEqual([]);
  });
});
