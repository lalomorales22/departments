import type { GoodDirection } from '@departments/shared';
import { accentVar } from '@/lib/status-theme';
import { cn } from '@/lib/cn';

/**
 * A signed delta, colored by whether it moved in the metric's good direction.
 * e.g. Bounce Rate `goodDirection: 'down'` with delta -3.1 → GREEN (good).
 */
export function DeltaChip({
  delta,
  goodDirection,
  className,
  suffix = '%',
}: {
  delta: number;
  goodDirection: GoodDirection;
  className?: string;
  suffix?: string;
}) {
  const isFlat = delta === 0;
  const movingUp = delta > 0;
  const isGood = goodDirection === 'up' ? movingUp : !movingUp;
  const accent = isFlat ? 'blue' : isGood ? 'green' : 'red';
  const color = isFlat ? 'var(--text-faint)' : accentVar(accent);
  const arrow = isFlat ? '→' : movingUp ? '▲' : '▼';

  return (
    <span
      className={cn('tabular inline-flex items-center gap-0.5 text-2xs font-medium', className)}
      style={{ color }}
    >
      <span aria-hidden>{arrow}</span>
      {Math.abs(delta).toFixed(1)}
      {suffix}
    </span>
  );
}
