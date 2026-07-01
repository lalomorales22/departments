'use client';

import { useMemo } from 'react';
import type { Loop } from '@departments/shared';
import { Bot, KanbanSquare, Layers, Users } from 'lucide-react';
import { SectionLabel, StatusDot } from '@/components/atoms';
import { useLoops, useLoopTree } from '@/lib/loops-client';
import { rosterForProvider } from '@/lib/roster';
import { aggregate, flattenRollup, rollupForest } from '@/lib/tree';
import { accentVar, isLiveLoopStatus, loopStatusAccent, loopStatusLabel } from '@/lib/status-theme';
import { useCockpit } from '@/lib/store';
import { AnalyticsView } from './AnalyticsView';
import { ArtifactsView } from './ArtifactsView';
import { SettingsView } from './SettingsView';

function healthAccent(h: number): 'green' | 'amber' | 'red' {
  return h >= 85 ? 'green' : h >= 60 ? 'amber' : 'red';
}
function usd(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`;
}

/**
 * ORG view (Phase 8): the six top tabs are whole-org aggregates across ALL loops. DASHBOARD
 * is the fleet mega-dashboard; AGENTS/TASKS roll up across loops; ARTIFACTS is the existing
 * cross-loop browser; ANALYTICS/SETTINGS are already org-scoped. Drilling into any loop
 * (a card here, or the left hierarchy) switches to that loop's own workspace (LOOP view).
 */
export function OrgView() {
  const activeTab = useCockpit((s) => s.activeTab);
  const selectedLoopId = useCockpit((s) => s.selectedLoopId);

  return (
    <div className="flex flex-col gap-3 p-3">
      {activeTab === 'DASHBOARD' && <OrgDashboard />}
      {activeTab === 'AGENTS' && <OrgAgents />}
      {activeTab === 'TASKS' && <OrgTasks />}
      {activeTab === 'ARTIFACTS' && <ArtifactsView loopId={selectedLoopId} />}
      {activeTab === 'ANALYTICS' && <AnalyticsView />}
      {activeTab === 'SETTINGS' && <SettingsView />}
    </div>
  );
}

/** The org banner: a title + the four headline aggregates. */
function OrgHeader() {
  const tree = useLoopTree();
  const agg = useMemo(() => aggregate(rollupForest(tree)), [tree]);
  const orgUtil = agg.totalBudgetUsd > 0 ? agg.totalSpentUsd / agg.totalBudgetUsd : 0;

  return (
    <div className="panel flex flex-wrap items-center justify-between gap-4 p-3">
      <div className="flex items-center gap-2.5">
        <Layers className="h-4 w-4 text-accent-cyan" strokeWidth={1.75} aria-hidden />
        <div>
          <div className="text-sm font-semibold tracking-wide text-text">ORGANIZATION</div>
          <div className="eyebrow">Whole-org overview · every department</div>
        </div>
      </div>
      <div className="flex items-center gap-5">
        <Headline label="Departments" value={String(agg.loopCount)} sub={`${agg.byStatus.running} running`} />
        <Headline
          label="Avg Health"
          value={`${agg.avgHealth}%`}
          accent={accentVar(healthAccent(agg.avgHealth))}
        />
        <Headline
          label="Org Spend"
          value={usd(agg.totalSpentUsd)}
          sub={`${Math.round(orgUtil * 100)}% of cap`}
          accent={accentVar(orgUtil > 0.8 ? 'amber' : 'green')}
        />
      </div>
    </div>
  );
}

function Headline({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="eyebrow">{label}</span>
      <span className="tabular text-xl leading-none text-text" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
      {sub && <span className="tabular mt-0.5 text-2xs text-faint">{sub}</span>}
    </div>
  );
}

/** Honest empty state shared by the org aggregates. */
function EmptyOrg({ what }: { what: string }) {
  return (
    <div className="panel flex flex-col items-center gap-2 px-4 py-10 text-center">
      <p className="text-sm text-muted">No departments yet.</p>
      <p className="max-w-sm text-2xs leading-relaxed text-faint">
        Create your first department with <span className="font-mono text-accent-cyan">loop &lt;name&gt;</span>{' '}
        in the command bar (or ⌘N) to see {what} aggregated here.
      </p>
    </div>
  );
}

// ── DASHBOARD — the fleet of loop cards ─────────────────────────────────────────

function OrgDashboard() {
  const loops = useLoops();
  const sorted = useMemo(
    () => [...loops].sort((a, b) => a.level - b.level || a.displayName.localeCompare(b.displayName)),
    [loops],
  );

  if (loops.length === 0) return <EmptyOrg what="fleet health" />;

  return (
    <>
      <OrgHeader />
      <SectionLabel
        icon={<Layers className="h-3.5 w-3.5" strokeWidth={1.75} />}
        right={<span className="tabular text-2xs text-faint">{loops.length} DEPARTMENTS</span>}
      >
        Departments
      </SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sorted.map((loop) => (
          <LoopCard key={loop.id} loop={loop} />
        ))}
      </div>
    </>
  );
}

function LoopCard({ loop }: { loop: Loop }) {
  const enterLoop = useCockpit((s) => s.enterLoop);
  const util = loop.budgetCapUsd > 0 ? loop.spentUsd / loop.budgetCapUsd : 0;

  return (
    <button
      type="button"
      onClick={() => enterLoop(loop.id)}
      className="panel group flex flex-col gap-2.5 p-3 text-left transition-colors hover:border-hairline-strong focus-ring"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot accent={loopStatusAccent[loop.status]} live={isLiveLoopStatus(loop.status)} size={7} />
          <span className="truncate text-sm font-medium text-text">{loop.displayName}</span>
        </div>
        <span className="shrink-0 font-mono text-2xs text-faint">L{loop.level}</span>
      </div>

      <p className="line-clamp-2 min-h-[2rem] text-2xs leading-relaxed text-muted">
        {loop.mission || <span className="text-faint">No mission set.</span>}
      </p>

      <div className="flex items-center justify-between">
        <span className="font-mono text-2xs uppercase tracking-wider text-faint">
          {loopStatusLabel[loop.status]}
        </span>
        <span
          className="tabular font-mono text-2xs"
          style={{ color: accentVar(healthAccent(loop.health)) }}
          title="rolling gate-pass health"
        >
          {loop.health}% health
        </span>
      </div>

      {/* spend / cap */}
      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full border border-hairline bg-bg-deep">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.round(util * 100))}%`,
              backgroundColor: accentVar(util > 0.8 ? 'amber' : 'green'),
            }}
          />
        </div>
        <span className="tabular shrink-0 font-mono text-2xs text-faint">
          {usd(loop.spentUsd)} / {usd(loop.budgetCapUsd)}
        </span>
      </div>

      <div className="flex items-center justify-between border-t border-hairline pt-2 text-2xs text-faint">
        <span className="font-mono">{loop.cadence}</span>
        <span className="font-mono">{loop.cycleCount} cycles</span>
      </div>
    </button>
  );
}

// ── AGENTS — every loop's roster, grouped ───────────────────────────────────────

function OrgAgents() {
  const loops = useLoops();
  const cfg = useCockpit((s) => s.providerConfig);
  const enterLoop = useCockpit((s) => s.enterLoop);

  if (loops.length === 0) return <EmptyOrg what="agent rosters" />;

  const total = loops.length * 4; // fixed canonical roster per loop

  return (
    <>
      <SectionLabel
        icon={<Bot className="h-3.5 w-3.5" strokeWidth={1.75} />}
        right={<span className="tabular text-2xs text-faint">{total} AGENTS · {loops.length} LOOPS</span>}
      >
        Agents across the org
      </SectionLabel>
      <div className="flex flex-col gap-3">
        {loops.map((loop) => {
          const roster = rosterForProvider(loop.id, cfg);
          return (
            <div key={loop.id} className="panel p-3">
              <button
                type="button"
                onClick={() => enterLoop(loop.id)}
                className="mb-2 flex items-center gap-2 text-left focus-ring"
              >
                <StatusDot accent={loopStatusAccent[loop.status]} live={isLiveLoopStatus(loop.status)} size={6} />
                <span className="text-xs font-medium text-text hover:text-accent-cyan">{loop.displayName}</span>
                <span className="font-mono text-2xs text-faint">L{loop.level}</span>
              </button>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {roster.map((a) => (
                  <div key={a.id} className="rounded-sm border border-hairline bg-bg-deep px-2 py-1.5">
                    <div className="font-mono text-2xs uppercase tracking-wider text-muted">{a.role}</div>
                    <div className="truncate font-mono text-2xs text-faint" title={a.modelId}>
                      {a.modelId}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── TASKS — honest cross-loop rollup ────────────────────────────────────────────

function OrgTasks() {
  const loops = useLoops();
  if (loops.length === 0) return <EmptyOrg what="tasks" />;

  return (
    <>
      <SectionLabel
        icon={<KanbanSquare className="h-3.5 w-3.5" strokeWidth={1.75} />}
        right={<span className="tabular text-2xs text-faint">{loops.length} LOOPS</span>}
      >
        Tasks across the org
      </SectionLabel>
      <div className="panel flex flex-col items-center gap-2 px-4 py-10 text-center">
        <Users className="h-5 w-5 text-faint" strokeWidth={1.5} aria-hidden />
        <p className="text-sm text-muted">No task board yet.</p>
        <p className="max-w-md text-2xs leading-relaxed text-faint">
          Tasks aren't persisted yet — a loop's board projects from its{' '}
          <span className="font-mono text-muted">TASKS.md</span> and run events. Once that projection
          lands, every department's TODO / IN&nbsp;PROGRESS / REVIEW / DONE lanes roll up here.
        </p>
      </div>
    </>
  );
}
