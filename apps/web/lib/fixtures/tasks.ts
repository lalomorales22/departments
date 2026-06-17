import type { Task } from '@departments/shared';
import { ORG } from './loops';

/**
 * Marketing Kanban — exactly 5 / 4 / 2 / 4 across TODO / IN PROGRESS / REVIEW / DONE
 * (matches the UI spec). Assignees reference marketing agent ids.
 */
export const TASKS: Task[] = [
  // ── TODO (5)
  mk('t-01', 'Audit top-12 competitor landing pages', 'research', 'P2', 'todo', 'agt-mkt-researcher', ['q3', 'competitive']),
  mk('t-02', 'Draft 6 short-form scripts for Comedeez', 'content', 'P2', 'todo', 'agt-mkt-copywriter', ['comedeez', 'short-form']),
  mk('t-03', 'Refresh local-IT keyword map', 'seo', 'P3', 'todo', 'agt-mkt-seo', ['southbay', 'local']),
  mk('t-04', 'Design 3 ad-creative variants', 'design', 'P3', 'todo', 'agt-mkt-designer', ['paid']),
  mk('t-05', 'Define Q3 brand-awareness KPI targets', 'analytics', 'P1', 'todo', 'agt-mkt-analyst', ['kpi', 'q3']),

  // ── IN PROGRESS (4)
  mk('t-06', 'Cluster 320 keywords into intent groups', 'seo', 'P2', 'in_progress', 'agt-mkt-seo', ['seo']),
  mk('t-07', 'Reallocate paid spend to top variants', 'campaign', 'P1', 'in_progress', 'agt-mkt-campaign', ['paid', 'optimize']),
  mk('t-08', 'Compute channel-level CAC + attribution', 'analytics', 'P2', 'in_progress', 'agt-mkt-analyst', ['cac']),
  mk('t-09', 'Competitor positioning scan (14 sites)', 'research', 'P2', 'in_progress', 'agt-mkt-researcher', ['competitive']),

  // ── REVIEW (2)
  mk('t-10', 'Editorial calendar v8 refresh', 'content', 'P2', 'review', 'agt-mkt-strategist', ['calendar']),
  mk('t-11', 'Landing-page hero copy rewrite', 'content', 'P1', 'review', 'agt-mkt-copywriter', ['conversion']),

  // ── DONE (4)
  mk('t-12', 'Q2 channel performance report', 'analytics', 'P2', 'done', 'agt-mkt-analyst', ['report']),
  mk('t-13', 'Set up UTM taxonomy + dashboards', 'analytics', 'P3', 'done', 'agt-mkt-analyst', ['tracking']),
  mk('t-14', 'Brand voice guidelines v2', 'content', 'P3', 'done', 'agt-mkt-strategist', ['brand']),
  mk('t-15', 'Migrate blog to new CMS', 'engineering', 'P2', 'done', 'agt-mkt-seo', ['infra']),
];

function mk(
  id: string,
  title: string,
  area: Task['area'],
  priority: Task['priority'],
  state: Task['state'],
  assigneeId: string,
  tags: string[],
): Task {
  return {
    id,
    orgId: ORG.id,
    loopId: 'loop-marketing',
    title,
    area,
    priority,
    state,
    assigneeId,
    tags,
    createdAt: '2026-06-14T10:00:00Z',
    updatedAt: '2026-06-16T09:00:00Z',
  };
}

export function getTasks(loopId: string): Task[] {
  return TASKS.filter((t) => t.loopId === loopId);
}
