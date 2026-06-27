'use client';

import { useMemo } from 'react';
import type { LoopStatus } from '@departments/shared';
import { SectionLabel, Sparkline } from '@/components/atoms';
import { useLoopTree } from '@/lib/loops-client';
import { useLiveHealth } from '@/lib/live';
import { accentVar, loopStatusAccent, loopStatusLabel } from '@/lib/status-theme';
import { useCockpit } from '@/lib/store';
import { aggregate, flattenRollup, rollupForest } from '@/lib/tree';

function healthAccent(h: number): 'green' | 'amber' | 'red' {
  return h >= 85 ? 'green' : h >= 60 ? 'amber' : 'red';
}

function usd(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
}

/** A deterministic, believable health-over-time series trending to `avg` (no live store yet). */
function synthSeries(avg: number, n = 24): number[] {
  return Array.from({ length: n }, (_, i) => {
    const wave = Math.sin(i / 2.2) * 3 + (i - n / 2) * 0.25;
    return Math.max(0, Math.min(100, Math.round(avg - 6 + (i / n) * 6 + wave)));
  });
}

/** A small KPI stat card. */
function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="panel flex flex-col gap-1 p-3">
      <span className="eyebrow">{label}</span>
      <span className="tabular text-2xl leading-none text-text" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
      {sub && <span className="tabular text-2xs text-faint">{sub}</span>}
    </div>
  );
}

/**
 * The ANALYTICS tab — a first cut on the cross-loop rollup views (the data the
 * `loop_rollup` / `org_health_daily` SQL objects back in prod): org KPIs, aggregate
 * health over time, per-loop comparison, and resource allocation. Every loop drills
 * down — clicking selects it and returns to the DASHBOARD.
 */
export function AnalyticsView() {
  const selectedLoopId = useCockpit((s) => s.selectedLoopId);
  const setSelectedLoop = useCockpit((s) => s.setSelectedLoop);
  const setTab = useCockpit((s) => s.setTab);
  const { health: liveHealth, live } = useLiveHealth(selectedLoopId);
  const tree = useLoopTree();

  const { forest, agg, allLoops, units } = useMemo(() => {
    const healthOf = (id: string) => (live && id === selectedLoopId ? liveHealth : undefined);
    const forest = rollupForest(tree, healthOf);
    const allLoops = forest.flatMap(flattenRollup);
    return { forest, agg: aggregate(forest), allLoops, units: forest };
  }, [tree, selectedLoopId, liveHealth, live]);

  const drill = (id: string) => {
    setSelectedLoop(id);
    setTab('DASHBOARD');
  };

  const running = agg.byStatus.running;
  const series = synthSeries(agg.avgHealth);
  const byHealth = [...allLoops].sort((a, b) => a.loop.health - b.loop.health);
  const orgUtil = agg.totalBudgetUsd > 0 ? agg.totalSpentUsd / agg.totalBudgetUsd : 0;

  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      {/* Org KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Loops" value={String(agg.loopCount)} sub={`${running} running`} />
        <Stat label="Avg Health" value={`${agg.avgHealth}%`} accent={accentVar(healthAccent(agg.avgHealth))} />
        <Stat label="Org Spend" value={usd(agg.totalSpentUsd)} sub={`of ${usd(agg.totalBudgetUsd)} cap`} accent={accentVar(orgUtil > 0.8 ? 'amber' : 'green')} />
        <Stat label="Utilization" value={`${Math.round(orgUtil * 100)}%`} sub="spend / budget" accent={accentVar(orgUtil > 0.8 ? 'amber' : 'green')} />
      </div>

      {/* Aggregate health over time + status mix */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="panel p-3">
          <SectionLabel right={<span className="tabular text-2xs text-faint">24 SAMPLES</span>}>
            Aggregate Health Over Time
          </SectionLabel>
          <div className="mt-3">
            <Sparkline data={series} accent={healthAccent(agg.avgHealth)} width={600} height={72} className="w-full" />
          </div>
          <div className="mt-1 flex justify-between">
            <span className="tabular text-2xs text-faint">{series[0]}%</span>
            <span className="tabular text-2xs text-faint">now {agg.avgHealth}%</span>
          </div>
        </div>

        <div className="panel p-3">
          <SectionLabel>Status Mix</SectionLabel>
          <ul className="mt-3 flex flex-col gap-2">
            {(Object.keys(agg.byStatus) as LoopStatus[])
              .filter((s) => agg.byStatus[s] > 0)
              .map((s) => {
                const pct = agg.loopCount ? (agg.byStatus[s] / agg.loopCount) * 100 : 0;
                return (
                  <li key={s} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-2xs text-muted">{loopStatusLabel[s]}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full border border-hairline bg-bg-deep">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: accentVar(loopStatusAccent[s]) }} />
                    </div>
                    <span className="tabular w-5 shrink-0 text-right text-2xs text-faint">{agg.byStatus[s]}</span>
                  </li>
                );
              })}
          </ul>
        </div>
      </div>

      {/* Per-loop comparison */}
      <div className="panel p-3">
        <SectionLabel right={<span className="tabular text-2xs text-faint">{allLoops.length} LOOPS</span>}>
          Per-Loop Health (lowest first)
        </SectionLabel>
        <ul className="mt-3 flex flex-col gap-1.5">
          {byHealth.map((n) => (
            <li key={n.loop.id}>
              <button
                type="button"
                onClick={() => drill(n.loop.id)}
                className="group flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-surface-2/60 focus-ring"
                title="Drill into this loop"
              >
                <span className="w-32 shrink-0 truncate text-xs text-muted group-hover:text-text">
                  {'·'.repeat(Math.max(0, n.loop.level - 1))} {n.loop.displayName}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full border border-hairline bg-bg-deep">
                  <div className="h-full rounded-full" style={{ width: `${n.loop.health}%`, backgroundColor: accentVar(healthAccent(n.loop.health)) }} />
                </div>
                <span className="tabular w-10 shrink-0 text-right text-2xs" style={{ color: accentVar(healthAccent(n.loop.health)) }}>
                  {n.loop.health}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Resource allocation across top-level units */}
      <div className="panel p-3">
        <SectionLabel>Resource Allocation (rolled-up spend by unit)</SectionLabel>
        <ul className="mt-3 flex flex-col gap-3">
          {units.map((u) => {
            const util = u.rolledBudgetUsd > 0 ? u.rolledSpentUsd / u.rolledBudgetUsd : 0;
            return (
              <li key={u.loop.id}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <button type="button" onClick={() => drill(u.loop.id)} className="text-xs text-muted hover:text-text focus-ring">
                    {u.loop.displayName}
                    <span className="ml-1 text-2xs text-faint">· {u.descendantCount + 1} loops</span>
                  </button>
                  <span className="tabular text-2xs text-faint">
                    {usd(u.rolledSpentUsd)} / {usd(u.rolledBudgetUsd)} · {Math.round(util * 100)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full border border-hairline bg-bg-deep">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, util * 100)}%`, backgroundColor: accentVar(util > 0.8 ? 'amber' : 'green') }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
