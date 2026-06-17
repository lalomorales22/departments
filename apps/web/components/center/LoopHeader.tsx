'use client';

import type { LoopStatus } from '@departments/shared';
import {
  accentVar,
  isLiveLoopStatus,
  loopStatusAccent,
  loopStatusLabel,
} from '@/lib/status-theme';
import { getLoop } from '@/lib/fixtures';
import { useLiveHealth, useLivePipeline, useRunStatus } from '@/lib/live';
import { StatusBadge, TimerDisplay } from '@/components/atoms';
import { cn } from '@/lib/cn';
import { HealthGauge } from './HealthGauge';

/** Map the live run status onto a loop status for the badge, or null when idle. */
function liveLoopStatus(run: ReturnType<typeof useRunStatus>): LoopStatus | null {
  switch (run) {
    case 'running':
      return 'running';
    case 'paused':
      return 'paused';
    case 'error':
      return 'error';
    case 'done':
      return 'idle';
    default:
      return null;
  }
}

/** Format a USD amount compactly (e.g. $612.40, $1.2k). */
function usd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

/** A labeled instrument readout: eyebrow on top, mono value below. */
function Readout({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-end gap-0.5', className)}>
      <span className="eyebrow">{label}</span>
      <div className="tabular text-sm leading-none text-text" data-machine>
        {children}
      </div>
    </div>
  );
}

/**
 * Active-loop instrument header: identity + status on the left, machine readouts
 * (elapsed, cycle, budget, health) on the right.
 */
export function LoopHeader({ loopId }: { loopId: string }) {
  const loop = getLoop(loopId);
  // Hooks must run unconditionally (before any early return).
  const pipeline = useLivePipeline(loopId);
  const { health } = useLiveHealth(loopId);
  const runStatus = useRunStatus(loopId);

  if (!loop) {
    return (
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="eyebrow">{'> loop'}</span>
        <span className="tabular text-sm text-muted" data-machine>
          {loopId} — not found
        </span>
      </div>
    );
  }

  // Live run status (once a real run starts) overlays the fixture status.
  const status = liveLoopStatus(runStatus) ?? loop.status;
  const running = status === 'running';
  const statusKey = loopStatusAccent[status];

  const budgetPct = loop.budgetCapUsd
    ? Math.min(100, (loop.spentUsd / loop.budgetCapUsd) * 100)
    : 0;
  // Budget bar shifts from calm → hot as it approaches the cap.
  const budgetKey = budgetPct >= 90 ? 'red' : budgetPct >= 70 ? 'amber' : 'green';
  const budgetColor = accentVar(budgetKey);

  return (
    <div className="flex items-start justify-between gap-6 px-4 py-3">
      {/* identity */}
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="eyebrow truncate">
            {'> loop '}
            {loop.name}
          </span>
          <StatusBadge
            accent={statusKey}
            label={loopStatusLabel[status]}
            live={isLiveLoopStatus(status)}
          />
        </div>
        <h1 className="truncate text-xl font-semibold leading-tight text-text">
          {loop.displayName}
        </h1>
        <p className="truncate text-2xs text-muted" title={loop.mission}>
          {loop.mission}
        </p>
      </div>

      {/* instrument cluster */}
      <div className="flex shrink-0 items-center gap-5">
        <Readout label="Elapsed">
          <TimerDisplay startSeconds={pipeline.elapsedSeconds} running={running} />
        </Readout>

        <div className="h-8 w-px self-center bg-hairline" aria-hidden />

        <Readout label="Cycle">
          <span className="text-faint">#</span>
          {pipeline.cycleCount}
        </Readout>

        <div className="h-8 w-px self-center bg-hairline" aria-hidden />

        <div className="flex w-28 flex-col items-stretch gap-1">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Budget</span>
            <span className="tabular text-2xs leading-none text-muted" data-machine>
              {usd(loop.spentUsd)}
              <span className="text-faint"> / {usd(loop.budgetCapUsd)}</span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-sm bg-surface-3">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${budgetPct}%`,
                backgroundColor: budgetColor,
                transition: 'width 0.4s ease-out',
              }}
            />
          </div>
        </div>

        <div className="h-8 w-px self-center bg-hairline" aria-hidden />

        <div className="flex flex-col items-center gap-0.5">
          <span className="eyebrow">Health</span>
          <HealthGauge value={health} accent={running ? undefined : statusKey} />
        </div>
      </div>
    </div>
  );
}
