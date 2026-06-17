import type { DeptEvent } from '@departments/events';

/**
 * A fixture terminal stream for the marketing loop. Mixed kinds so the LogConsole's
 * LOGS / DEBUG / OUTPUT tabs all have content. `seq` is monotonic; the realtime
 * store (Phase 3) will append to this with the same contract.
 */
let seq = 0;
const base = (kind: DeptEvent['kind'], tsSeconds: number) => ({
  id: `evt-${kind}-${seq}`,
  seq: seq++,
  loopId: 'loop-marketing',
  runId: 'run-mkt-47',
  ts: `2026-06-16T09:${String(10 + Math.floor(tsSeconds / 60)).padStart(2, '0')}:${String(tsSeconds % 60).padStart(2, '0')}Z`,
});

export const LOGS: DeptEvent[] = [
  { ...base('status', 0), kind: 'status', payload: { scope: 'loop', targetId: 'loop-marketing', loopStatus: 'running', phase: 'execute' } },
  { ...base('log', 2), kind: 'log', payload: { level: 'info', source: 'engine', message: 'Cycle 47 · phase EXECUTE · reattached session sess_8c21' } },
  { ...base('agent_msg', 4), kind: 'agent_msg', payload: { agentId: 'agt-mkt-campaign', message: 'Reading TASKS.md + last HANDOFF; 4 tasks assigned to me this cycle.' } },
  { ...base('tool_use', 6), kind: 'tool_use', payload: { agentId: 'agt-mkt-researcher', tool: 'web_search', phase: 'start', summary: 'web_search("competitor pricing 2026 managed IT")' } },
  { ...base('output', 8), kind: 'output', payload: { agentId: 'agt-mkt-researcher', text: 'Found 14 candidate competitors; deduping by domain…', streaming: true } },
  { ...base('tool_use', 11), kind: 'tool_use', payload: { agentId: 'agt-mkt-researcher', tool: 'web_search', phase: 'result', summary: '14 results · 9 unique domains' } },
  { ...base('debug', 12), kind: 'debug', payload: { agentId: 'agt-mkt-seo', message: 'embedding 320 keywords (model=text-embed) batch=4', detail: { batches: 4, dims: 1536 } } },
  { ...base('log', 14), kind: 'log', payload: { level: 'info', source: 'planner', message: 'Editorial calendar v8 drafted → moved to REVIEW' } },
  { ...base('agent_msg', 16), kind: 'agent_msg', payload: { agentId: 'agt-mkt-analyst', message: 'CAC down 5.2% WoW — paid video cohort is driving it.' } },
  { ...base('metric', 18), kind: 'metric', payload: { key: 'cac', name: 'Cost per Acquisition', value: 32.1, display: '$32.10', delta: -5.2, goodDirection: 'down', unit: 'USD' } },
  { ...base('tool_use', 20), kind: 'tool_use', payload: { agentId: 'agt-mkt-campaign', tool: 'mcp:ads.update_budget', phase: 'start', summary: 'shift $1.8k → variant_C (paused for approval)' } },
  { ...base('log', 22), kind: 'log', payload: { level: 'warn', source: 'guardrail', message: 'always_ask: budget reallocation > $1k requires Commander approval — paused.' } },
  { ...base('output', 24), kind: 'output', payload: { agentId: 'agt-mkt-strategist', text: 'Proposing 6 short-form hooks optimized for first-2s retention.', streaming: true } },
  { ...base('debug', 26), kind: 'debug', payload: { agentId: 'agt-mkt-seo', message: 'kmeans k=12 silhouette=0.61', detail: { k: 12, silhouette: 0.61 } } },
  { ...base('metric', 28), kind: 'metric', payload: { key: 'qualified_traffic', name: 'Qualified Traffic', value: 24800, display: '24.8K', delta: 12.4, goodDirection: 'up', unit: 'sessions' } },
  { ...base('log', 30), kind: 'log', payload: { level: 'info', source: 'engine', message: 'cache_read_input_tokens=18,204 (hit) · cache_creation=312' } },
  { ...base('agent_msg', 33), kind: 'agent_msg', payload: { agentId: 'agt-mkt-researcher', message: 'Positioning scan complete: 3 competitors moved to value-based pricing.' } },
  { ...base('tool_use', 35), kind: 'tool_use', payload: { agentId: 'agt-mkt-analyst', tool: 'sql.query', phase: 'result', summary: 'attribution rollup · 19 rows · 240ms' } },
  { ...base('output', 37), kind: 'output', payload: { agentId: 'agt-mkt-analyst', text: 'Channel mix: paid 41% · organic 33% · email 18% · referral 8%.', streaming: false } },
  { ...base('log', 39), kind: 'log', payload: { level: 'info', source: 'engine', message: 'EXECUTE outputs staged → handing to EVALUATE grader (Opus 4.8, independent).' } },
  { ...base('error', 41), kind: 'error', payload: { agentId: 'agt-mkt-seo', message: 'sitemap fetch 429 from cdn — backing off 8s, will retry', code: 'RATE_LIMIT' } },
  { ...base('log', 44), kind: 'log', payload: { level: 'info', source: 'engine', message: 'retry ok · sitemap 1,204 urls parsed' } },
];

export function getLogs(loopId: string): DeptEvent[] {
  return LOGS.filter((e) => e.loopId === loopId);
}
