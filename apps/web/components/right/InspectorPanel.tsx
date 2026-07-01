'use client';

import { useMemo, type ReactNode } from 'react';
import { useLoopById, useLoopTree } from '@/lib/loops-client';
import { useCockpit } from '@/lib/store';
import { SectionLabel } from '@/components/atoms';
import { aggregate, rollupForest } from '@/lib/tree';
import { accentVar } from '@/lib/status-theme';
import { InspectorConfig } from './InspectorConfig';
import { InspectorDetails } from './InspectorDetails';
import { InspectorHistory } from './InspectorHistory';

function healthAccent(h: number): 'green' | 'amber' | 'red' {
  return h >= 85 ? 'green' : h >= 60 ? 'amber' : 'red';
}
function usd(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`;
}

/**
 * The right inspector (Phase 8): a SINGLE scrolling page — DETAILS, CONFIG, and HISTORY
 * stacked as sections instead of three tabs. In ORG view it shows a whole-org summary +
 * a hint to drill into a loop; in LOOP view it's the selected loop's side context.
 */
export function InspectorPanel({ loopId }: { loopId: string }) {
  const viewMode = useCockpit((s) => s.viewMode);
  const loop = useLoopById(loopId);

  if (viewMode === 'org') return <OrgInspector />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b border-hairline px-3 py-2.5">
        <SectionLabel
          right={
            <span className="truncate text-xs font-medium text-text">{loop?.displayName ?? '—'}</span>
          }
        >
          Loop Inspector
        </SectionLabel>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section label="Details">
          <InspectorDetails loopId={loopId} />
        </Section>
        <Section label="Config">
          <InspectorConfig loopId={loopId} />
        </Section>
        <Section label="History">
          <InspectorHistory loopId={loopId} />
        </Section>
      </div>
    </div>
  );
}

/** A labeled section within the single-scroll inspector. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-b border-hairline last:border-b-0">
      <div className="sticky top-0 z-10 border-b border-hairline bg-surface/95 px-3 py-2 backdrop-blur-sm">
        <span className="eyebrow">{label}</span>
      </div>
      {children}
    </section>
  );
}

/** The org-mode side panel: aggregate stats + a drill-in hint. */
function OrgInspector() {
  const tree = useLoopTree();
  const agg = useMemo(() => aggregate(rollupForest(tree)), [tree]);
  const orgUtil = agg.totalBudgetUsd > 0 ? agg.totalSpentUsd / agg.totalBudgetUsd : 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="shrink-0 border-b border-hairline px-3 py-2.5">
        <SectionLabel right={<span className="text-xs font-medium text-text">Organization</span>}>
          Overview
        </SectionLabel>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <dl className="flex flex-col gap-2.5">
          <Row label="Departments" value={String(agg.loopCount)} />
          <Row label="Running" value={String(agg.byStatus.running)} accent={accentVar('green')} />
          <Row label="Avg health" value={`${agg.avgHealth}%`} accent={accentVar(healthAccent(agg.avgHealth))} />
          <Row label="Org spend" value={usd(agg.totalSpentUsd)} />
          <Row label="Budget cap" value={usd(agg.totalBudgetUsd)} />
          <Row
            label="Utilization"
            value={`${Math.round(orgUtil * 100)}%`}
            accent={accentVar(orgUtil > 0.8 ? 'amber' : 'green')}
          />
        </dl>

        <p className="mt-4 rounded-sm border border-hairline bg-surface-2/40 px-2.5 py-2 text-2xs leading-relaxed text-faint">
          Select a department — in the hierarchy or a card — to open its workspace and inspect its
          mission, config, and history here.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-2xs uppercase tracking-wider text-faint">{label}</dt>
      <dd className="tabular font-mono text-xs text-text" style={accent ? { color: accent } : undefined}>
        {value}
      </dd>
    </div>
  );
}
