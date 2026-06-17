import { describe, expect, it } from 'vitest';
import type { DeptEvent } from '@departments/events';
import { topicsFor } from './topics';

const base = { loopId: 'mkt', ts: '2026-06-17T00:00:00Z' } as const;

describe('topicsFor', () => {
  it('routes console-ish kinds to the loop logs channel', () => {
    for (const kind of ['log', 'debug', 'output', 'agent_msg', 'tool_use'] as const) {
      const e = { ...base, id: kind, seq: 0, kind, payload: {} } as unknown as DeptEvent;
      expect(topicsFor(e)).toEqual(['loop:mkt:logs']);
    }
  });

  it('routes metrics to the metrics channel', () => {
    const e: DeptEvent = {
      ...base,
      id: 'm',
      seq: 1,
      kind: 'metric',
      payload: { key: 'cost_usd', name: 'Cost', value: 1, display: '$1', delta: 0, goodDirection: 'down' },
    };
    expect(topicsFor(e)).toEqual(['loop:mkt:metrics']);
  });

  it('routes errors to logs AND the global system topic', () => {
    const e: DeptEvent = { ...base, id: 'err', seq: 2, kind: 'error', payload: { message: 'x' } };
    expect(topicsFor(e)).toEqual(['loop:mkt:logs', 'global:system']);
  });

  it('routes a loop phase-transition status to BOTH status and pipeline channels', () => {
    const e: DeptEvent = {
      ...base,
      id: 's',
      seq: 3,
      kind: 'status',
      payload: { scope: 'loop', targetId: 'mkt', loopStatus: 'running', phase: 'execute' },
    };
    expect(topicsFor(e)).toEqual(['loop:mkt:status', 'loop:mkt:pipeline']);
  });

  it('routes an agent-scoped status to that agent topic', () => {
    const e: DeptEvent = {
      ...base,
      id: 'a',
      seq: 4,
      kind: 'status',
      payload: { scope: 'agent', targetId: 'agt-planner', agentStatus: 'running' },
    };
    expect(topicsFor(e)).toEqual(['agent:agt-planner:status']);
  });
});
