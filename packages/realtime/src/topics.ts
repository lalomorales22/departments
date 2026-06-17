/**
 * topics.ts — maps a {@link DeptEvent} to the set of WS topics it fans out to.
 *
 * The topic strings are the FROZEN helpers from `@departments/events`
 * (`loopTopic/agentTopic/tasksTopic/SYSTEM_TOPIC`) — this module invents none. The
 * SSE transport carries everything for a loop on one connection and lets the client
 * demux via selectors; the WS gateway uses this router to multiplex per-topic
 * subscriptions. Keeping the mapping in one tested place means both transports agree
 * on what "the pipeline channel" or "an agent's status channel" contains.
 */
import type { DeptEvent } from '@departments/events';
import { agentTopic, loopTopic, SYSTEM_TOPIC } from '@departments/events';

/**
 * Every topic an event should be published to. An event commonly lands on more than
 * one (e.g. a phase-transition `status` is both pipeline and status; an `error` is a
 * log line AND a system-wide signal).
 */
export function topicsFor(e: DeptEvent): string[] {
  const loopId = e.loopId;
  switch (e.kind) {
    case 'log':
    case 'debug':
    case 'output':
    case 'agent_msg':
    case 'tool_use':
      return [loopTopic(loopId, 'logs')];

    case 'metric':
      return [loopTopic(loopId, 'metrics')];

    case 'error':
      // Errors are both a console line and an org-wide signal (alerting/StatusBar).
      return [loopTopic(loopId, 'logs'), SYSTEM_TOPIC];

    case 'status': {
      const p = e.payload;
      const topics: string[] = [];
      if (p.scope === 'agent') {
        topics.push(agentTopic(p.targetId));
      }
      // Loop/session lifecycle drives the status channel...
      if (p.loopStatus !== undefined || p.scope === 'loop' || p.scope === 'session') {
        topics.push(loopTopic(loopId, 'status'));
      }
      // ...and any phase transition drives the pipeline channel.
      if (p.phase !== undefined) {
        topics.push(loopTopic(loopId, 'pipeline'));
      }
      // A status with neither (defensive): keep it on the loop status channel.
      if (topics.length === 0) topics.push(loopTopic(loopId, 'status'));
      return dedupe(topics);
    }

    default:
      return [loopTopic(loopId, 'logs')];
  }
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
