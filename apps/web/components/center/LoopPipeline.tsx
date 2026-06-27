'use client';

import type { CyclePhase } from '@departments/shared';
import { PIPELINE } from '@departments/shared';
import {
  Bot,
  Check,
  ClipboardList,
  Database,
  Rocket,
  ShieldCheck,
  StepForward,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { accentVar, glowVar } from '@/lib/status-theme';
import {
  useLiveActivity,
  useLivePipeline,
  useLiveUsage,
  useRunCycleInfo,
  useRunMode,
  useRunStatus,
} from '@/lib/live';
import { useRealtime } from '@/lib/realtime';
import { SectionLabel, TimerDisplay } from '@/components/atoms';
import { cn } from '@/lib/cn';

/** Stage icon keyed by engine phase (improve === OPTIMIZE). */
const STAGE_ICON: Record<CyclePhase, LucideIcon> = {
  plan: ClipboardList,
  execute: Bot,
  evaluate: ShieldCheck,
  improve: Rocket,
  memory: Database,
};

type StageStatus = 'pending' | 'active' | 'complete' | 'error';

/** Compact token count (e.g. 842, 1.2k, 3.4M). */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

/** The signature lifecycle visualizer: PLAN → EXECUTE → EVALUATE → OPTIMIZE → MEMORY. */
export function LoopPipeline({ loopId }: { loopId: string }) {
  const pipeline = useLivePipeline(loopId);
  const mode = useRunMode(loopId);
  const runStatus = useRunStatus(loopId);
  const activity = useLiveActivity(loopId);
  const usage = useLiveUsage(loopId);
  const { total: cycleTotal, base: cycleBase } = useRunCycleInfo(loopId);
  const setMode = useRealtime((s) => s.setMode);
  const step = useRealtime((s) => s.step);

  const auto = mode === 'auto';
  const running = runStatus === 'running';
  const done = runStatus === 'done';
  // In manual STEP mode, an active run waits for an explicit advance.
  const canStep = mode === 'step' && running;

  // Where we are in the five-stage cycle — drives the overall progress bar + "phase n of 5".
  const activeIdx = pipeline.activePhase
    ? PIPELINE.findIndex((s) => s.phase === pipeline.activePhase)
    : -1;
  const activeStage = activeIdx >= 0 ? PIPELINE[activeIdx] : null;
  const activeColor = activeStage ? accentVar(activeStage.accent) : accentVar('green');
  const phaseNum = activeIdx >= 0 ? activeIdx + 1 : done ? PIPELINE.length : 0;
  // The in-progress phase counts as half-done so the bar advances within a stage, not just
  // at the boundary; a finished cycle reads 100%.
  const overallPct = done ? 100 : activeIdx >= 0 ? ((activeIdx + 0.5) / PIPELINE.length) * 100 : 0;
  const showOverall = running || done;

  // "Cycle N of M" for a multi-cycle run (N = the engine's absolute cycle − the run's base);
  // otherwise the absolute cycle counter.
  const cycleN = Math.min(cycleTotal, Math.max(1, pipeline.cycleCount - cycleBase));
  const showCycleOfM = cycleTotal > 1 && (running || done);

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <SectionLabel
        right={
          <>
            <span className="tabular text-2xs text-muted" data-machine>
              {showCycleOfM ? `CYCLE ${cycleN}/${cycleTotal}` : `CYCLE #${pipeline.cycleCount}`}
            </span>
            {canStep && (
              <button
                type="button"
                onClick={() => void step(loopId)}
                title="Advance one phase"
                aria-label="Advance one phase"
                className="focus-ring tabular inline-flex items-center gap-1 rounded-sm border border-accent-cyan/40 px-1.5 py-0.5 text-2xs uppercase tracking-wider text-accent-cyan transition-colors hover:text-text"
                style={{ backgroundColor: 'color-mix(in oklab, var(--accent-cyan) 12%, transparent)' }}
                data-machine
              >
                <StepForward className="h-3 w-3" strokeWidth={2} aria-hidden />
                STEP
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode(loopId, auto ? 'step' : 'auto')}
              aria-pressed={auto}
              title={auto ? 'Auto-progress (switch to manual single-step)' : 'Manual single-step (switch to auto)'}
              className={cn(
                'focus-ring tabular rounded-sm border px-1.5 py-0.5 text-2xs uppercase tracking-wider transition-colors',
                auto
                  ? 'border-accent-cyan/40 text-accent-cyan'
                  : 'border-hairline text-faint hover:text-muted',
              )}
              style={auto ? { backgroundColor: 'color-mix(in oklab, var(--accent-cyan) 10%, transparent)' } : undefined}
              data-machine
            >
              {auto ? 'AUTO' : 'STEP'}
            </button>
          </>
        }
      >
        Loop Pipeline
      </SectionLabel>

      {/* Overall cycle progress: "phase n of 5" + a thin determinate bar across the pipeline. */}
      {showOverall && (
        <div className="flex items-center gap-3">
          <span className="eyebrow shrink-0" data-machine>
            {phaseNum >= 1 ? `phase ${phaseNum} of ${PIPELINE.length}` : 'starting'}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full"
              style={{
                width: `${overallPct}%`,
                backgroundColor: done ? accentVar('green') : activeColor,
                transition: 'width 0.5s ease-out',
              }}
            />
          </div>
        </div>
      )}

      <ol className="flex items-stretch">
        {PIPELINE.map((stage, i) => {
          const status: StageStatus = pipeline.stageStatus[stage.phase] ?? 'pending';
          const Icon = STAGE_ICON[stage.phase];
          const color = accentVar(stage.accent);
          const isActive = status === 'active';
          const isComplete = status === 'complete';
          const isError = status === 'error';
          const isPending = status === 'pending' || isError;

          return (
            <li key={stage.phase} className="flex min-w-0 flex-1 items-start">
              {/* connector entering this node */}
              {i > 0 && (
                <div className="relative flex h-9 flex-1 items-center" aria-hidden>
                  <svg className="h-2 w-full" preserveAspectRatio="none" viewBox="0 0 100 4">
                    <line
                      x1="0"
                      y1="2"
                      x2="100"
                      y2="2"
                      stroke="var(--surface-3)"
                      strokeWidth="2"
                    />
                    {isActive && (
                      <line
                        x1="0"
                        y1="2"
                        x2="100"
                        y2="2"
                        stroke={color}
                        strokeWidth="2"
                        strokeDasharray="8 8"
                        className="animate-flow-dash"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </svg>
                </div>
              )}

              {/* the stage node */}
              <div
                title={`${stage.label}\nconsumes: ${stage.consumes}\nproduces: ${stage.produces}`}
                className={cn(
                  'group flex min-w-0 flex-[2] flex-col gap-1.5 rounded-md border bg-surface p-2.5 transition-colors',
                  isActive ? 'border-hairline-strong' : 'border-hairline',
                )}
                style={
                  isActive
                    ? {
                        borderColor: `color-mix(in oklab, ${color} 50%, transparent)`,
                        boxShadow: glowVar(stage.accent),
                        backgroundColor: `color-mix(in oklab, ${color} 8%, var(--surface))`,
                      }
                    : undefined
                }
                aria-current={isActive ? 'step' : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border"
                    style={{
                      color: isPending ? 'var(--text-faint)' : color,
                      borderColor: isPending
                        ? 'var(--border)'
                        : `color-mix(in oklab, ${color} 35%, transparent)`,
                      backgroundColor: isPending
                        ? 'transparent'
                        : `color-mix(in oklab, ${color} 12%, transparent)`,
                      opacity: isComplete ? 0.7 : 1,
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </span>

                  {isComplete && (
                    <Check
                      className="h-3.5 w-3.5 shrink-0"
                      strokeWidth={2}
                      style={{ color, opacity: 0.7 }}
                      aria-hidden
                    />
                  )}
                  {isActive && (
                    <span
                      className="tabular inline-flex items-center gap-1 text-2xs uppercase tracking-wider"
                      style={{ color }}
                      data-machine
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full"
                        style={{ backgroundColor: color }}
                        aria-hidden
                      />
                      LIVE
                    </span>
                  )}
                </div>

                <span
                  className="tabular text-2xs font-medium uppercase tracking-wider leading-none"
                  style={{
                    color: isPending ? 'var(--text-faint)' : color,
                    opacity: isComplete ? 0.8 : 1,
                  }}
                  data-machine
                >
                  {stage.label}
                </span>

                <span
                  className={cn(
                    'truncate text-2xs leading-tight',
                    isPending ? 'text-faint' : 'text-muted',
                  )}
                  title={stage.blurb}
                >
                  {stage.blurb}
                </span>

                {/* Per-stage progress track: complete = filled, active = indeterminate
                    shimmer (we can't know a phase's total work), error = red, else empty. */}
                <div
                  className="relative mt-0.5 h-[3px] w-full overflow-hidden rounded-full bg-surface-3"
                  aria-hidden
                >
                  {isComplete && (
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{ backgroundColor: color, opacity: 0.55 }}
                    />
                  )}
                  {isActive && (
                    <>
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{ backgroundColor: `color-mix(in oklab, ${color} 28%, transparent)` }}
                      />
                      <div
                        className="absolute inset-0 animate-scan rounded-full"
                        style={{ background: `linear-gradient(90deg, transparent 0%, ${color} 50%, transparent 100%)` }}
                      />
                    </>
                  )}
                  {isError && (
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{ backgroundColor: accentVar('red'), opacity: 0.6 }}
                    />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* "Running" strip: makes an active run unmistakably alive — the live phase, the latest
          streamed line, and a ticking elapsed + token meter, right under the pipeline. */}
      {running && (
        <div
          className="flex items-center gap-3 rounded-md border bg-surface px-3 py-1.5"
          style={{ borderColor: `color-mix(in oklab, ${activeColor} 30%, var(--border))` }}
          aria-live="polite"
        >
          <span
            className="tabular inline-flex shrink-0 items-center gap-1.5 text-2xs uppercase tracking-wider"
            style={{ color: activeColor }}
            data-machine
          >
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full"
              style={{ backgroundColor: activeColor }}
              aria-hidden
            />
            {activeStage ? activeStage.label : 'STARTING'}
          </span>

          <span
            className="min-w-0 flex-1 truncate font-mono text-2xs text-muted"
            title={activity.lastLine ?? undefined}
          >
            {activity.lastLine ?? 'warming up…'}
          </span>

          <span
            className="tabular inline-flex shrink-0 items-center gap-3 text-2xs text-muted"
            data-machine
          >
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3 w-3 text-faint" strokeWidth={2} aria-hidden />
              <TimerDisplay startSeconds={pipeline.elapsedSeconds} running />
            </span>
            <span style={{ color: accentVar('green') }}>{fmtTokens(usage.tokens)} tok</span>
          </span>
        </div>
      )}
    </div>
  );
}
