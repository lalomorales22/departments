'use client';

import { useCockpit } from '@/lib/store';
import { LoopHeader } from './LoopHeader';
import { LoopPipeline } from './LoopPipeline';
import { AgentGrid } from './AgentGrid';
import { KanbanBoard } from './KanbanBoard';
import { MetricGrid } from './MetricGrid';
import { LogConsole } from './LogConsole';
import { ActivityMap } from './ActivityMap';
import { AnalyticsView } from './AnalyticsView';
import { ArtifactsView } from './ArtifactsView';
import { SettingsView } from './SettingsView';
import { ApprovalBanner } from './ApprovalBanner';

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
      <ApprovalBanner loopId={loopId} />

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

      {activeTab === 'ARTIFACTS' && <ArtifactsView loopId={loopId} />}
      {activeTab === 'ANALYTICS' && <AnalyticsView />}
      {activeTab === 'SETTINGS' && <SettingsView />}
    </div>
  );
}
