'use client';

import { getMetrics } from '@/lib/fixtures';
import { SectionLabel, StatusDot } from '@/components/atoms';
import { MetricCard } from './MetricCard';

/** REAL-TIME METRICS section: live header + responsive grid of metric tiles. */
export function MetricGrid({ loopId }: { loopId: string }) {
  const metrics = getMetrics(loopId);

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel
        right={
          <span className="tabular inline-flex items-center gap-1.5 text-2xs font-medium text-accent-green">
            <StatusDot accent="green" live size={6} />
            LIVE
          </span>
        }
      >
        REAL-TIME METRICS
      </SectionLabel>

      {metrics.length === 0 ? (
        <p className="tabular text-2xs text-faint">No metrics for this loop.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
          {metrics.map((metric) => (
            <MetricCard key={metric.id} metric={metric} />
          ))}
        </div>
      )}
    </section>
  );
}
