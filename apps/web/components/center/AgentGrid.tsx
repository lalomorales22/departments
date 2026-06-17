'use client';

import type { Agent } from '@departments/shared';
import { Users } from 'lucide-react';
import { SectionLabel } from '@/components/atoms';
import { getAgents } from '@/lib/fixtures';
import { accentVar } from '@/lib/status-theme';
import { cn } from '@/lib/cn';
import { AgentCard } from './AgentCard';

/** Running agents float to the top; the rest keep their fixture order. */
function sortRunningFirst(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const ar = a.status === 'running' ? 0 : 1;
    const br = b.status === 'running' ? 0 : 1;
    return ar - br;
  });
}

/**
 * The AGENTS grid for a loop. Eyebrow header carries a live running/total count
 * (running tinted green per the status theme); the responsive grid defaults to 4
 * columns wide / 2 narrow and honors an explicit `columns` override.
 */
export function AgentGrid({ loopId, columns }: { loopId: string; columns?: number }) {
  const agents = sortRunningFirst(getAgents(loopId));
  const total = agents.length;
  const running = agents.filter((a) => a.status === 'running').length;

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel
        icon={<Users className="h-3.5 w-3.5" strokeWidth={1.75} />}
        right={
          <span className="tabular text-2xs text-faint">
            <span style={{ color: accentVar('green') }}>{running} RUNNING</span>
            {' / '}
            {total} TOTAL
          </span>
        }
      >
        Agents
      </SectionLabel>

      {total === 0 ? (
        <div className="rounded border border-dashed border-hairline bg-surface px-4 py-8 text-center text-xs text-faint">
          No agents in this loop yet.
        </div>
      ) : (
        <div
          className={cn(
            'grid gap-2.5',
            columns == null && 'grid-cols-2 xl:grid-cols-4',
          )}
          style={
            columns != null
              ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
              : undefined
          }
        >
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </section>
  );
}
