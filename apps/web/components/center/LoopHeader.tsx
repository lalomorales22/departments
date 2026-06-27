'use client';

import type { LoopStatus } from '@departments/shared';
import {
  accentVar,
  isLiveLoopStatus,
  loopStatusAccent,
  loopStatusLabel,
} from '@/lib/status-theme';
import { useLoopById } from '@/lib/loops-client';
import { useLiveHealth, useLivePipeline, useLiveUsage, useRunStatus } from '@/lib/live';
import { StatusBadge, TimerDisplay } from '@/components/atoms';
import { useCockpit } from '@/lib/store';
import { cn } from '@/lib/cn';
import { HealthGauge } from './HealthGauge';

/** A chip showing which AI backend will actually drive this loop — so a fake and a real
 *  run never look identical. Green = local Ollama ($0), purple = Claude (metered). */
function ProviderBadge() {
  const cfg = useCockpit((s) => s.providerConfig);
  const isOllama = cfg.provider === 'ollama';
  const model = isOllama ? cfg.ollamaModel : cfg.claudeModel || 'tiered';
  const key = isOllama ? 'green' : 'purple';
  const ready = isOllama ? Boolean(cfg.ollamaModel) : Boolean(cfg.anthropicApiKey);
  return (
    <span
      className="tabular inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs"
      style={{
        color: accentVar(ready ? key : 'amber'),
        borderColor: `color-mix(in oklab, ${accentVar(ready ? key : 'amber')} 40%, transparent)`,
      }}
      title={ready ? `Runs on ${cfg.provider} · ${model}` : 'Pick a model / add a key in Settings → AI Provider'}
    >
      {isOllama ? 'Ollama' : 'Claude'}
      <span className="text-faint">·</span>
      {ready ? model : 'not configured'}
    </span>
  );
}

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

/** Compact token count (e.g. 842, 1.2k, 3.4M). */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
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
  const loop = useLoopById(loopId);
  // Hooks must run unconditionally (before any early return).
  const pipeline = useLivePipeline(loopId);
  const { health } = useLiveHealth(loopId);
  const usage = useLiveUsage(loopId);
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

  // Spend ticks live from the engine's cumulative cost metric during a run; otherwise the
  // loop's stored spend. (Local Ollama runs read $0 — the honest number.)
  const spent = usage.live ? usage.costUsd : loop.spentUsd;
  const budgetPct = loop.budgetCapUsd ? Math.min(100, (spent / loop.budgetCapUsd) * 100) : 0;
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
          <ProviderBadge />
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

        <Readout label="Tokens">
          <span style={usage.live && running ? { color: accentVar('green') } : undefined}>
            {fmtTokens(usage.tokens)}
          </span>
        </Readout>

        <div className="h-8 w-px self-center bg-hairline" aria-hidden />

        <div className="flex w-28 flex-col items-stretch gap-1">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Cost</span>
            <span className="tabular text-2xs leading-none text-muted" data-machine>
              {usd(spent)}
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
