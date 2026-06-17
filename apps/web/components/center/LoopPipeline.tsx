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
  type LucideIcon,
} from 'lucide-react';
import { StepForward } from 'lucide-react';
import { accentVar, glowVar } from '@/lib/status-theme';
import { useLivePipeline, useRunMode, useRunStatus } from '@/lib/live';
import { useRealtime } from '@/lib/realtime';
import { SectionLabel } from '@/components/atoms';
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

/** The signature lifecycle visualizer: PLAN → EXECUTE → EVALUATE → OPTIMIZE → MEMORY. */
export function LoopPipeline({ loopId }: { loopId: string }) {
  const pipeline = useLivePipeline(loopId);
  const mode = useRunMode(loopId);
  const runStatus = useRunStatus(loopId);
  const setMode = useRealtime((s) => s.setMode);
  const step = useRealtime((s) => s.step);

  const auto = mode === 'auto';
  // In manual STEP mode, an active run waits for an explicit advance.
  const canStep = mode === 'step' && runStatus === 'running';

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <SectionLabel
        right={
          <>
            <span className="tabular text-2xs text-muted" data-machine>
              CYCLE #{pipeline.cycleCount}
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

      <ol className="flex items-stretch">
        {PIPELINE.map((stage, i) => {
          const status: StageStatus = pipeline.stageStatus[stage.phase] ?? 'pending';
          const Icon = STAGE_ICON[stage.phase];
          const color = accentVar(stage.accent);
          const isActive = status === 'active';
          const isComplete = status === 'complete';
          const isPending = status === 'pending' || status === 'error';

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
                  isActive ? 'border-hairline-strong animate-pulse' : 'border-hairline',
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
                      className="tabular text-2xs uppercase tracking-wider"
                      style={{ color }}
                      data-machine
                    >
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
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
