-- ════════════════════════════════════════════════════════════════════════════
-- 0100_seed.sql — demo seed for the "South Bay IT Solutions" org.
--
-- Mirrors apps/web/lib/fixtures/* so the seeded DB matches the Phase 1 cockpit
-- exactly: one org, the Commander, the CEO → Marketing tree (+ a couple children),
-- the canonical 8 marketing agents (5 running / 3 idle), a 5/4/2/4 Kanban, six
-- metric cards (bounce_rate + cac good_direction = down), five artifacts, five
-- memory rows.
--
-- Created-at values are CURRENT ERA (2026, NOT 2024) and match the fixtures.
--
-- Fixed UUIDs are used so FKs resolve deterministically and re-seeding is stable.
--
-- RLS: this script pins app.current_org to the South Bay org id, so it loads
-- cleanly even when RLS is enabled (provided the loading role is not blocked by a
-- missing GUC). A privileged bulk-load path may instead run as a BYPASSRLS role;
-- either works. The SET LOCAL must run inside the same transaction as the INSERTs.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Pin the tenant for this transaction so org-scoped RLS policies pass.
SET LOCAL app.current_org = 'a0000000-0000-4000-8000-000000000001';

-- ─────────────────────────────────────────────────────────────────────────────
-- Org + Commander
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO org (id, name, slug, created_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'South Bay IT Solutions', 'southbay', '2026-04-02T16:20:00Z');

INSERT INTO app_user (id, org_id, name, email, role, initials, created_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'Commander', 'southbayitsolutions619@gmail.com', 'commander', 'CM', '2026-04-02T16:20:00Z');

-- ─────────────────────────────────────────────────────────────────────────────
-- Loops — CEO (L1 parent) → Marketing (L1) → Comedeez (L2) + South Bay IT (L2)
-- phase 'execute' on the running ones; engine 'improve' would render as OPTIMIZE.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO loop (
  id, org_id, parent_loop_id, name, display_name, level, mission, status, health,
  phase, cycle_count, cadence, cma_agent_id, memory_store_id, repo_url,
  budget_cap_usd, spent_usd, created_at, updated_at
) VALUES
  -- CEO meta-loop (root)
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', NULL,
   'ceo', 'CEO', 1,
   'Run the organization: prioritize initiatives, allocate budget, and drive growth across every department.',
   'running', 92, 'plan', 184, 'nightly', 'agt_ceo_v4', 'mem_ceo',
   'git@dept:org-southbay/ceo.git', 4000, 2410.55, '2026-04-02T16:24:00Z', '2026-06-16T09:02:00Z'),

  -- Marketing (the cockpit's selected/active loop)
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001',
   'marketing', 'Marketing', 1,
   'Increase brand awareness and drive qualified traffic across owned, earned, and paid channels.',
   'running', 95, 'execute', 47, 'continuous', 'agt_mkt_v7', 'mem_marketing',
   'git@dept:org-southbay/marketing.git', 1200, 612.40, '2026-05-28T14:10:00Z', '2026-06-16T09:14:22Z'),

  -- Comedeez (L2 brand child of marketing)
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002',
   'comedeez', 'Comedeez', 2,
   'Grow the Comedeez brand: ship a steady drumbeat of short-form comedy content that converts followers to subscribers.',
   'running', 88, 'execute', 31, 'continuous', 'agt_comedeez_v3', 'mem_comedeez',
   'git@dept:org-southbay/comedeez.git', 500, 188.20, '2026-05-30T11:00:00Z', '2026-06-16T08:55:00Z'),

  -- South Bay IT (L2 product/service child of marketing)
  ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002',
   'southbayitsolutions', 'South Bay IT', 2,
   'Generate qualified MSP leads in the San Diego / South Bay region through local SEO and referrals.',
   'idle', 81, NULL, 22, 'daily', 'agt_southbay_v2', 'mem_southbay',
   'git@dept:org-southbay/southbay.git', 400, 142.60, '2026-05-29T17:45:00Z', '2026-06-16T06:30:00Z');

-- ─────────────────────────────────────────────────────────────────────────────
-- Agents — the canonical 8 marketing agents.
-- RUNNING: Market Researcher, Content Strategist, SEO Specialist, Campaign
-- Manager, Data Analyst.  IDLE: Copywriter, Graphic Designer, Performance Reviewer.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO agent (id, org_id, loop_id, role, name, model_id, effort, status, activity, created_at) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', 'executor', 'Market Researcher',
   'claude-sonnet-4-6', 'high', 'running',
   'Scanning 14 competitor sites for Q3 positioning shifts', '2026-05-28T14:11:00Z'),

  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', 'planner', 'Content Strategist',
   'claude-opus-4-8', 'high', 'running',
   'Refreshing the editorial calendar from this cycle''s learnings', '2026-05-28T14:11:00Z'),

  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', 'executor', 'SEO Specialist',
   'claude-sonnet-4-6', 'medium', 'running',
   'Clustering 320 keywords into 12 intent groups', '2026-05-28T14:11:00Z'),

  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', 'coordinator', 'Campaign Manager',
   'claude-opus-4-8', 'high', 'running',
   'Reallocating paid spend toward the 3 best-performing variants', '2026-05-28T14:11:00Z'),

  ('d0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', 'executor', 'Data Analyst',
   'claude-sonnet-4-6', 'high', 'running',
   'Computing channel-level CAC and attribution deltas', '2026-05-28T14:11:00Z'),

  ('d0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', 'executor', 'Copywriter',
   'claude-sonnet-4-6', 'medium', 'idle',
   'Idle — awaiting approved briefs from the strategist', '2026-05-28T14:11:00Z'),

  ('d0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', 'executor', 'Graphic Designer',
   'claude-sonnet-4-6', 'medium', 'idle',
   'Idle — no assets queued this cycle', '2026-05-28T14:11:00Z'),

  ('d0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000002', 'reviewer', 'Performance Reviewer',
   'claude-opus-4-8', 'high', 'idle',
   'Idle — runs at EVALUATE; independent grader (no self-grading)', '2026-05-28T14:11:00Z');

-- ─────────────────────────────────────────────────────────────────────────────
-- Tasks — marketing Kanban: 5 todo / 4 in_progress / 2 review / 4 done = 15.
-- assignee_id references the marketing agents above.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO task (id, org_id, loop_id, title, area, priority, state, assignee_id, tags, created_at, updated_at) VALUES
  -- TODO (5)
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Audit top-12 competitor landing pages', 'research', 'P2', 'todo',
   'd0000000-0000-4000-8000-000000000001', '{q3,competitive}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Draft 6 short-form scripts for Comedeez', 'content', 'P2', 'todo',
   'd0000000-0000-4000-8000-000000000006', '{comedeez,short-form}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Refresh local-IT keyword map', 'seo', 'P3', 'todo',
   'd0000000-0000-4000-8000-000000000003', '{southbay,local}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Design 3 ad-creative variants', 'design', 'P3', 'todo',
   'd0000000-0000-4000-8000-000000000007', '{paid}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Define Q3 brand-awareness KPI targets', 'analytics', 'P1', 'todo',
   'd0000000-0000-4000-8000-000000000005', '{kpi,q3}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),

  -- IN PROGRESS (4)
  ('e0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Cluster 320 keywords into intent groups', 'seo', 'P2', 'in_progress',
   'd0000000-0000-4000-8000-000000000003', '{seo}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Reallocate paid spend to top variants', 'campaign', 'P1', 'in_progress',
   'd0000000-0000-4000-8000-000000000004', '{paid,optimize}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Compute channel-level CAC + attribution', 'analytics', 'P2', 'in_progress',
   'd0000000-0000-4000-8000-000000000005', '{cac}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Competitor positioning scan (14 sites)', 'research', 'P2', 'in_progress',
   'd0000000-0000-4000-8000-000000000001', '{competitive}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),

  -- REVIEW (2)
  ('e0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Editorial calendar v8 refresh', 'content', 'P2', 'review',
   'd0000000-0000-4000-8000-000000000002', '{calendar}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Landing-page hero copy rewrite', 'content', 'P1', 'review',
   'd0000000-0000-4000-8000-000000000006', '{conversion}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),

  -- DONE (4)
  ('e0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Q2 channel performance report', 'analytics', 'P2', 'done',
   'd0000000-0000-4000-8000-000000000005', '{report}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Set up UTM taxonomy + dashboards', 'analytics', 'P3', 'done',
   'd0000000-0000-4000-8000-000000000005', '{tracking}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Brand voice guidelines v2', 'content', 'P3', 'done',
   'd0000000-0000-4000-8000-000000000002', '{brand}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'Migrate blog to new CMS', 'engineering', 'P2', 'done',
   'd0000000-0000-4000-8000-000000000003', '{infra}', '2026-06-14T10:00:00Z', '2026-06-16T09:00:00Z');

-- ─────────────────────────────────────────────────────────────────────────────
-- Metrics — six live cards. bounce_rate + cac have good_direction 'down'
-- (a negative delta there is GOOD/green); the rest are 'up'.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO metric (id, org_id, loop_id, key, name, value, display, delta, good_direction, series, unit, ts) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'qualified_traffic', 'Qualified Traffic', 24800, '24.8K', 12.4, 'up',
   '{18.2,18.9,19.4,19.1,20.2,20.8,21.0,20.6,21.7,22.3,22.0,22.9,23.4,23.1,23.8,24.2,24.0,24.5,24.8}',
   'sessions', '2026-06-16T09:14:00Z'),

  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'bounce_rate', 'Bounce Rate', 42.3, '42.3%', -3.1, 'down',
   '{48.1,47.6,47.9,46.8,46.2,46.5,45.7,45.1,45.4,44.6,44.0,44.3,43.6,43.2,43.5,42.9,42.6,42.8,42.3}',
   '%', '2026-06-16T09:14:00Z'),

  ('f0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'conversion_rate', 'Conversion Rate', 3.42, '3.42%', 0.38, 'up',
   '{2.9,2.95,3.0,2.98,3.05,3.1,3.08,3.15,3.12,3.2,3.18,3.25,3.3,3.28,3.34,3.38,3.36,3.4,3.42}',
   '%', '2026-06-16T09:14:00Z'),

  ('f0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'brand_reach', 'Brand Reach', 1240000, '1.24M', 8.7, 'up',
   '{0.92,0.95,0.98,1.0,1.03,1.05,1.04,1.08,1.11,1.1,1.14,1.16,1.15,1.19,1.21,1.2,1.23,1.22,1.24}',
   'impressions', '2026-06-16T09:14:00Z'),

  ('f0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'cac', 'Cost per Acquisition', 32.1, '$32.10', -5.2, 'down',
   '{38.4,37.9,38.1,37.2,36.6,36.9,36.0,35.4,35.7,34.8,34.2,34.5,33.8,33.3,33.6,33.0,32.6,32.8,32.1}',
   'USD', '2026-06-16T09:14:00Z'),

  ('f0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'engagement_rate', 'Engagement Rate', 71.2, '71.2%', 2.3, 'up',
   '{64.1,64.8,65.2,65.0,66.1,66.7,66.4,67.3,68.0,67.7,68.6,69.2,68.9,69.8,70.3,70.0,70.8,70.6,71.2}',
   '%', '2026-06-16T09:14:00Z');

-- ─────────────────────────────────────────────────────────────────────────────
-- Artifacts — the files-as-memory set for marketing.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO artifact (id, org_id, loop_id, kind, path, version, size_bytes, updated_at) VALUES
  ('11000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'readme', 'README.md', 'v4', 8240, '2026-06-01T10:00:00Z'),
  ('11000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'tasks', 'TASKS.md', 'v47', 6110, '2026-06-16T09:02:00Z'),
  ('11000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'handoff', 'HANDOFF.md', 'v47', 3380, '2026-06-16T09:14:00Z'),
  ('11000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'report', 'REPORT.md', 'v46', 5020, '2026-06-15T21:40:00Z'),
  ('11000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'strategy', 'STRATEGY.md', 'v6', 4470, '2026-06-08T09:30:00Z');

-- ─────────────────────────────────────────────────────────────────────────────
-- Memory — five distilled entries for marketing. embedding left NULL (unused in
-- Phase 1; populated by the engine in Phase 2 via packages/memory).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO memory (id, org_id, loop_id, path, summary, content_ref, created_at) VALUES
  ('12000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'HANDOFF.md#decisions',
   'Short-form video out-converts static by 2.4x on paid — shift 40% of creative budget to video.',
   'sha:9af2c1', '2026-06-15T21:40:00Z'),
  ('12000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'REPORT.md#cycle-46',
   'Tuesday 10am PT sends beat all other windows by 18% open rate; lock as the default send time.',
   'sha:71be40', '2026-06-14T18:05:00Z'),
  ('12000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'memory/insights/seo.md',
   '"managed IT services san diego" is high-intent, low-difficulty — prioritize a pillar page.',
   'sha:0cc9d2', '2026-06-12T15:20:00Z'),
  ('12000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'memory/insights/brand.md',
   'Comedeez audience skews 18-24; humor-first hooks in the first 2s retain 3x longer.',
   'sha:4d1aa8', '2026-06-10T12:00:00Z'),
  ('12000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
   'STRATEGY.md#guardrails',
   'CEO objective: hold CAC under $35 while growing qualified traffic 10%+ MoM.',
   'sha:b32f57', '2026-06-08T09:30:00Z');

COMMIT;
