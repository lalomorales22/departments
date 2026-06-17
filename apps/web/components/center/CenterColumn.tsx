'use client';

import { useCockpit } from '@/lib/store';
import { LoopHeader } from './LoopHeader';
import { LoopPipeline } from './LoopPipeline';
import { AgentGrid } from './AgentGrid';
import { KanbanBoard } from './KanbanBoard';
import { MetricGrid } from './MetricGrid';
import { LogConsole } from './LogConsole';
import { ActivityMap } from './ActivityMap';
import { SectionLabel } from '../atoms';

/**
 * The center instrument stack. DASHBOARD shows the full cockpit; AGENTS / TASKS focus
 * a single organism; ARTIFACTS / ANALYTICS / SETTINGS are labeled stubs (built out in
 * later phases). The header + pipeline are always present so the active loop reads
 * clearly regardless of tab.
 */
export function CenterColumn({ loopId }: { loopId: string }) {
  const activeTab = useCockpit((s) => s.activeTab);

  return (
    <div className="flex flex-col gap-3 p-3">
      <LoopHeader loopId={loopId} />
      <LoopPipeline loopId={loopId} />

      {activeTab === 'DASHBOARD' && (
        <>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <AgentGrid loopId={loopId} />
            <KanbanBoard loopId={loopId} />
          </div>
          <MetricGrid loopId={loopId} />
          <div id="log-console" className="grid grid-cols-1 gap-3 lg:grid-cols-[1.7fr_1fr]">
            <LogConsole loopId={loopId} />
            <div id="activity-map">
              <ActivityMap />
            </div>
          </div>
        </>
      )}

      {activeTab === 'AGENTS' && (
        <>
          <AgentGrid loopId={loopId} columns={3} />
          <div id="log-console">
            <LogConsole loopId={loopId} />
          </div>
        </>
      )}

      {activeTab === 'TASKS' && <KanbanBoard loopId={loopId} />}

      {activeTab === 'ARTIFACTS' && (
        <TabStub title="ARTIFACTS" phase="Phase 4" blurb="Cross-loop file & memory browser with semantic search, markdown render, and version diff." />
      )}
      {activeTab === 'ANALYTICS' && (
        <TabStub title="ANALYTICS" phase="Phase 4–5" blurb="Aggregate health over time, per-loop comparison, resource allocation, and drill-down." />
      )}
      {activeTab === 'SETTINGS' && (
        <TabStub title="SETTINGS" phase="Phase 5" blurb="Workspace defaults, gate thresholds, members & roles, billing/limits, integrations." />
      )}
    </div>
  );
}

function TabStub({ title, phase, blurb }: { title: string; phase: string; blurb: string }) {
  return (
    <div className="panel grid-floor flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center">
      <SectionLabel>{title}</SectionLabel>
      <p className="max-w-md text-sm text-muted">{blurb}</p>
      <span className="rounded-sm border border-hairline bg-surface-2 px-2 py-0.5 font-mono text-2xs uppercase tracking-wider text-faint">
        Lands in {phase}
      </span>
    </div>
  );
}
