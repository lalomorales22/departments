import type { Metric } from '@departments/shared';

/**
 * Metric cards. Real metrics stream from a running loop's `metric` events (see
 * `useLiveMetrics`); there is no static seed — empty until a loop runs. No mock data.
 */
export const METRICS: Metric[] = [];

export function getMetrics(_loopId: string): Metric[] {
  return METRICS;
}
