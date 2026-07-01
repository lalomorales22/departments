'use client';

import { ChevronLeft } from 'lucide-react';
import { useCockpit } from '@/lib/store';
import { useLoopById } from '@/lib/loops-client';
import { LoopHeader } from './LoopHeader';
import { LoopPipeline } from './LoopPipeline';
import { AgentGrid } from './AgentGrid';
import { KanbanBoard } from './KanbanBoard';
import { MetricGrid } from './MetricGrid';
import { LogConsole } from './LogConsole';
import { ActivityMap } from './ActivityMap';
import { ApprovalBanner } from './ApprovalBanner';
import { OrgView } from './OrgView';

/**
 * The center column routes on the IA mode (Phase 8): ORG shows the whole-org aggregate
 * tabs; LOOP shows a single loop's dedicated workspace — its header, live pipeline,
 * agents, task board, metrics, and console on one scrolling page, with a breadcrumb
 * back to the org.
 */
export function CenterColumn({ loopId }: { loopId: string }) {
  const viewMode = useCockpit((s) => s.viewMode);
  if (viewMode === 'org') return <OrgView />;
  return <LoopWorkspace loopId={loopId} />;
}

function LoopWorkspace({ loopId }: { loopId: string }) {
  const loop = useLoopById(loopId);
  const backToOrg = useCockpit((s) => s.backToOrg);

  return (
    <div className="flex flex-col gap-3 p-3">
      <Breadcrumb name={loop?.displayName} level={loop?.level} onBack={backToOrg} />

      {!loopId || !loop ? (
        <div className="panel flex flex-col items-center gap-2 px-4 py-10 text-center">
          <p className="text-sm text-muted">That department is no longer available.</p>
          <button
            type="button"
            onClick={backToOrg}
            className="rounded-sm border border-hairline px-3 py-1.5 text-2xs uppercase tracking-wider text-muted hover:text-text focus-ring"
          >
            Back to org
          </button>
        </div>
      ) : (
        <>
          <LoopHeader loopId={loopId} />
          <LoopPipeline loopId={loopId} />
          <ApprovalBanner loopId={loopId} />

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
    </div>
  );
}

/** `← ORG / <loop>` — the return path from a loop workspace to the whole-org view. */
function Breadcrumb({ name, level, onBack }: { name?: string; level?: number; onBack: () => void }) {
  return (
    <nav className="flex items-center gap-1.5 text-2xs" aria-label="Breadcrumb">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 rounded-sm px-1.5 py-1 font-mono uppercase tracking-wider text-muted transition-colors hover:text-accent-cyan focus-ring"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        Org
      </button>
      <span className="text-faint" aria-hidden>
        /
      </span>
      <span className="flex items-center gap-1.5 font-medium text-text">
        {name ?? '—'}
        {level != null && <span className="font-mono text-2xs text-faint">L{level}</span>}
      </span>
    </nav>
  );
}
