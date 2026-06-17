'use client';

import { useState } from 'react';
import { Camera, Pause, Play, Square, StepForward, type LucideIcon } from 'lucide-react';
import { useCockpit } from '@/lib/store';
import { cn } from '@/lib/cn';

/** A single square hairline transport button. */
function TransportButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  activeAccent,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  /** CSS var for the active tint (e.g. 'var(--accent-green)'). */
  activeAccent?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'focus-ring grid h-7 w-7 place-items-center rounded-sm border border-hairline bg-surface-2 text-muted transition-colors hover:border-hairline-strong hover:text-text',
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
 * Transport cluster: play / pause / single-step / stop, a hairline divider, then a
 * screenshot button. Single-step nudges the pipeline out of auto-layout (manual feel);
 * the rest reflect a local running state. When running, Pause reads as active green.
 */
export function TransportBar() {
  const [running, setRunning] = useState(true);
  const toggleAutoLayout = useCockpit((s) => s.toggleAutoLayout);

  return (
    <div className="flex items-center gap-1">
      <TransportButton icon={Play} label="Run" onClick={() => setRunning(true)} active={running} />
      <TransportButton
        icon={Pause}
        label="Pause"
        onClick={() => setRunning(false)}
        active={running}
        activeAccent="var(--accent-green)"
      />
      <TransportButton icon={StepForward} label="Single-step" onClick={toggleAutoLayout} />
      <TransportButton icon={Square} label="Stop" onClick={() => setRunning(false)} />
      <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
      <TransportButton icon={Camera} label="Screenshot" />
    </div>
  );
}
