'use client';

import type { Loop, Phase } from '@departments/shared';
import { getMemory } from '@/lib/fixtures';
import { useLoopById } from '@/lib/loops-client';
import { useRunTrace } from '@/lib/live';
import { accentVar, phaseAccent } from '@/lib/status-theme';
import { SectionLabel } from '@/components/atoms';

/** A synthesized cycle-history entry (newest first). */
interface HistoryEntry {
  id: string;
  /** Engine phase that produced the entry — colors the rail dot. */
  phase: Phase;
  /** Short mono timestamp / cycle stamp shown above the title. */
  stamp: string;
  title: string;
  sub: string;
}

/** Compact path basename + anchor for a memory sub-line. */
function memoSource(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/**
 * Build a believable recent-cycle timeline from fixtures: the latest few cycle
 * milestones (synthesized off the loop's cycleCount + phase order) interleaved with
 * distilled MEMORY decisions. Newest at top.
 */
function buildHistory(loopId: string, loop: Loop | undefined): HistoryEntry[] {
  const memory = getMemory(loopId);
  const cycle = loop?.cycleCount ?? 0;
  const entries: HistoryEntry[] = [];

  // Most recent cycle milestones — written newest-first.
  entries.push({
    id: 'cy-memory',
    phase: 'memory',
    stamp: `CYCLE ${cycle} · MEMORY`,
    title: 'wrote HANDOFF.md',
    sub: 'distilled cycle decisions → durable memory',
  });
  entries.push({
    id: 'cy-improve',
    phase: 'improve',
    stamp: `CYCLE ${cycle} · OPTIMIZE`,
    title: `REPORT.md v${cycle - 1}`,
    sub: 'reprioritized backlog · refined strategy delta',
  });
  entries.push({
    id: 'cy-evaluate',
    phase: 'evaluate',
    stamp: `CYCLE ${cycle} · EVALUATE`,
    title: 'four gates scored',
    sub: 'independent grader · 3/4 pass',
  });
  entries.push({
    id: 'cy-execute',
    phase: 'execute',
    stamp: `CYCLE ${cycle} · EXECUTE`,
    title: 'agents produced work',
    sub: 'task-state changes · sub-artifacts staged',
  });
  entries.push({
    id: 'cy-plan',
    phase: 'plan',
    stamp: `CYCLE ${cycle} · PLAN`,
    title: `TASKS.md v${cycle}`,
    sub: 'goals + assignments refreshed from memory',
  });

  // A few distilled decisions, attributed to the MEMORY phase.
  for (const m of memory.slice(0, 3)) {
    entries.push({
      id: `mem-${m.id}`,
      phase: 'memory',
      stamp: 'DECISION',
      title: m.summary,
      sub: memoSource(m.path),
    });
  }

  return entries;
}

export function InspectorHistory({ loopId }: { loopId: string }) {
  // Live per-run trace when a real run has streamed; else the synthesized fixture timeline.
  const loop = useLoopById(loopId);
  const trace = useRunTrace(loopId);
  const entries = trace ?? buildHistory(loopId, loop);
  const live = trace !== null;

  return (
    <div className="animate-fade-in px-3 py-3">
      <SectionLabel
        right={
          <span className="tabular text-2xs text-faint">
            {live ? 'LIVE · ' : ''}
            {entries.length}
          </span>
        }
      >
        {live ? 'Run Trace' : 'Cycle Timeline'}
      </SectionLabel>

      {/* vertical hairline rail on the left; dots sit on it */}
      <ol className="relative mt-3 pl-5">
        <span
          className="absolute bottom-1 left-[3.5px] top-1 w-px bg-hairline"
          aria-hidden
        />
        {entries.map((e) => {
          const color = accentVar(phaseAccent(e.phase));
          return (
            <li key={e.id} className="relative pb-4 last:pb-0">
              <span
                className="absolute -left-5 top-1 h-2 w-2 rounded-full border border-bg"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <p className="tabular text-2xs uppercase tracking-wider text-faint">{e.stamp}</p>
              <p className="mt-0.5 text-xs leading-snug text-text">{e.title}</p>
              <p className="tabular mt-0.5 text-2xs text-muted">{e.sub}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
