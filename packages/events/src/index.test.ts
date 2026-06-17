import { describe, expect, it } from 'vitest';
import {
  agentTopic,
  ALWAYS_SETTLE_KINDS,
  EVENT_PROTOCOL_VERSION,
  isAlwaysSettle,
  loopStreamKey,
  loopTopic,
  SYSTEM_TOPIC,
  tasksTopic,
  type DeptEvent,
} from './index.js';

describe('frozen event protocol', () => {
  it('pins the wire version at 1 (bump only on a breaking change)', () => {
    expect(EVENT_PROTOCOL_VERSION).toBe(1);
  });

  it('topic + stream-key helpers produce the canonical strings', () => {
    expect(loopTopic('mkt', 'logs')).toBe('loop:mkt:logs');
    expect(loopTopic('mkt', 'pipeline')).toBe('loop:mkt:pipeline');
    expect(agentTopic('agt-planner')).toBe('agent:agt-planner:status');
    expect(tasksTopic('mkt')).toBe('tasks:mkt');
    expect(SYSTEM_TOPIC).toBe('global:system');
    expect(loopStreamKey('mkt')).toBe('loop:mkt:events');
  });

  it('status/metric/error are the always-settle kinds', () => {
    expect([...ALWAYS_SETTLE_KINDS].sort()).toEqual(['error', 'metric', 'status']);
  });

  it('isAlwaysSettle reflects ALWAYS_SETTLE_KINDS', () => {
    const status: DeptEvent = {
      id: 's',
      seq: 0,
      loopId: 'mkt',
      ts: '2026-06-17T00:00:00Z',
      kind: 'status',
      payload: { scope: 'loop', targetId: 'mkt', loopStatus: 'running' },
    };
    const log: DeptEvent = {
      id: 'l',
      seq: 1,
      loopId: 'mkt',
      ts: '2026-06-17T00:00:00Z',
      kind: 'log',
      payload: { level: 'info', message: 'hi' },
    };
    expect(isAlwaysSettle(status)).toBe(true);
    expect(isAlwaysSettle(log)).toBe(false);
  });
});
