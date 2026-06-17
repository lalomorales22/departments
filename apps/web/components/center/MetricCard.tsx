'use client';

import type { AccentKey, Metric } from '@departments/shared';
import { DeltaChip, Sparkline } from '@/components/atoms';

/**
 * Resolve the sparkline accent the same way DeltaChip colors itself:
 * flat (no change) → blue, moved in the metric's good direction → green, else red.
 */
function deltaAccentFor(delta: number, goodDirection: Metric['goodDirection']): AccentKey {
  if (delta === 0) return 'blue';
  const movingUp = delta > 0;
  const isGood = goodDirection === 'up' ? movingUp : !movingUp;
  return isGood ? 'green' : 'red';
}

/** A single real-time metric tile: label + delta, big value, full-width trend. */
export function MetricCard({ metric }: { metric: Metric }) {
  const deltaAccent = deltaAccentFor(metric.delta, metric.goodDirection);

  return (
    <div className="group flex flex-col rounded border border-hairline bg-surface transition-colors hover:border-hairline-strong">
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5">
        <span className="eyebrow truncate">{metric.name}</span>
        <DeltaChip delta={metric.delta} goodDirection={metric.goodDirection} />
      </div>

      <div className="flex items-baseline gap-1.5 px-3 pb-2 pt-1.5">
        <span className="tabular text-2xl font-semibold leading-none text-text">
          {metric.display}
        </span>
        {metric.unit != null && (
          <span className="tabular text-2xs text-faint">{metric.unit}</span>
        )}
      </div>

      <Sparkline
        data={metric.series}
        accent={deltaAccent}
        height={34}
        fill
        className="w-full"
      />
    </div>
  );
}
