'use client';

import { Camera, Pause, Play, StepForward, type LucideIcon } from 'lucide-react';
import { useCockpit } from '@/lib/store';
import { useRealtime } from '@/lib/realtime';
import { useRunMode, useRunStatus } from '@/lib/live';
import { useCan } from '@/lib/rbac';
import { cn } from '@/lib/cn';

/** A single square hairline transport button. */
function TransportButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
  activeAccent,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  /** CSS var for the active tint (e.g. 'var(--accent-green)'). */
  activeAccent?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'focus-ring grid h-7 w-7 place-items-center rounded-sm border border-hairline bg-surface-2 text-muted transition-colors hover:border-hairline-strong hover:text-text disabled:opacity-40 disabled:hover:border-hairline disabled:hover:text-muted',
        active && 'text-text',
      )}
      style={
        active && activeAccent
          ? {
              color: activeAccent,
              borderColor: `color-mix(in oklab, ${activeAccent} 45%, transparent)`,
              backgroundColor: `color-mix(in oklab, ${activeAccent} 14%, transparent)`,
            }
          : undefined
      }
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

/**
 * Transport cluster, wired to the REAL engine for the selected loop: Run fires a cycle,
 * Pause flips the run into manual STEP mode (pausing auto-progression between phases),
 * Single-step advances one phase while a step-mode run is waiting, and Screenshot is a
 * Phase-5 stub. Buttons reflect live run status + mode rather than a local toggle.
 */
export function TransportBar() {
  const loopId = useCockpit((s) => s.selectedLoopId);
  const runLoop = useRealtime((s) => s.runLoop);
  const step = useRealtime((s) => s.step);
  const setMode = useRealtime((s) => s.setMode);
  const runStatus = useRunStatus(loopId);
  const mode = useRunMode(loopId);
  // Capability gating (RBAC): Viewer is read-only; Operator can run/step; Commander
  // also holds pause (the kill switch). The gateway enforces the same matrix server-side.
  const canRun = useCan('loop.run');
  const canPause = useCan('loop.pause');
  const canStepCap = useCan('loop.step');
  const canShot = useCan('artifact.screenshot');

  const running = runStatus === 'running';
  const stepMode = mode === 'step';
  const canStep = stepMode && running;

  return (
    <div className="flex items-center gap-1">
      <TransportButton
        icon={Play}
        label={canRun ? 'Run one cycle' : 'Run one cycle — requires Operator or higher'}
        onClick={() => void runLoop(loopId)}
        active={running}
        disabled={running || !canRun}
        activeAccent="var(--accent-green)"
      />
      <TransportButton
        icon={Pause}
        label={
          !canPause
            ? 'Manual stepping — requires Commander'
            : stepMode
              ? 'Manual stepping (click to resume auto)'
              : 'Pause: switch to manual single-step'
        }
        onClick={() => setMode(loopId, stepMode ? 'auto' : 'step')}
        active={stepMode}
        disabled={!canPause}
        activeAccent="var(--accent-amber)"
      />
      <TransportButton
        icon={StepForward}
        label={canStepCap ? 'Advance one phase' : 'Advance one phase — requires Operator or higher'}
        onClick={() => void step(loopId)}
        disabled={!canStep || !canStepCap}
      />
      <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
      <TransportButton
        icon={Camera}
        label={canShot ? 'Screenshot the workspace (Phase 5 — stub)' : 'Screenshot — requires Operator or higher'}
        disabled
      />
    </div>
  );
}
