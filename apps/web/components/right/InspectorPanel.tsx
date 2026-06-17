'use client';

import { getLoop } from '@/lib/fixtures';
import { type InspectorTab, useCockpit } from '@/lib/store';
import { cn } from '@/lib/cn';
import { SectionLabel } from '@/components/atoms';
import { InspectorConfig } from './InspectorConfig';
import { InspectorDetails } from './InspectorDetails';
import { InspectorHistory } from './InspectorHistory';

const INSPECTOR_TABS: readonly InspectorTab[] = ['DETAILS', 'CONFIG', 'HISTORY'];

export function InspectorPanel({ loopId }: { loopId: string }) {
  const inspectorTab = useCockpit((s) => s.inspectorTab);
  const setInspectorTab = useCockpit((s) => s.setInspectorTab);
  const loop = getLoop(loopId);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {/* header */}
      <div className="shrink-0 border-b border-hairline px-3 py-2.5">
        <SectionLabel
          right={
            <span className="truncate text-xs font-medium text-text">
              {loop?.displayName ?? '—'}
            </span>
          }
        >
          Loop Inspector
        </SectionLabel>
      </div>

      {/* tab strip — active = cyan underline */}
      <div
        className="flex shrink-0 items-stretch border-b border-hairline"
        role="tablist"
        aria-label="Inspector views"
      >
        {INSPECTOR_TABS.map((tab) => {
          const active = inspectorTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setInspectorTab(tab)}
              className={cn(
                'focus-ring relative flex-1 px-2 py-2 font-mono text-2xs uppercase tracking-wider transition-colors',
                active ? 'text-accent-cyan' : 'text-faint hover:text-muted',
              )}
            >
              {tab}
              {active && (
                <span
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-accent-cyan"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      {/* sub-view — scrolls internally */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {inspectorTab === 'DETAILS' && <InspectorDetails loopId={loopId} />}
        {inspectorTab === 'CONFIG' && <InspectorConfig loopId={loopId} />}
        {inspectorTab === 'HISTORY' && <InspectorHistory loopId={loopId} />}
      </div>
    </div>
  );
}
