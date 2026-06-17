import type { Metric } from '@departments/shared';
import { ORG } from './loops';

/**
 * Six real-time metric cards for marketing. Each carries `goodDirection` so the
 * DeltaChip colors correctly — e.g. Bounce Rate and CAC are `down`, so a negative
 * delta is GREEN (good), a positive delta is RED.
 */
export const METRICS: Metric[] = [
  {
    id: 'm-traffic',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    key: 'qualified_traffic',
    name: 'Qualified Traffic',
    value: 24800,
    display: '24.8K',
    delta: 12.4,
    goodDirection: 'up',
    unit: 'sessions',
    series: [18.2, 18.9, 19.4, 19.1, 20.2, 20.8, 21.0, 20.6, 21.7, 22.3, 22.0, 22.9, 23.4, 23.1, 23.8, 24.2, 24.0, 24.5, 24.8],
    ts: '2026-06-16T09:14:00Z',
  },
  {
    id: 'm-bounce',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    key: 'bounce_rate',
    name: 'Bounce Rate',
    value: 42.3,
    display: '42.3%',
    delta: -3.1,
    goodDirection: 'down',
    unit: '%',
    series: [48.1, 47.6, 47.9, 46.8, 46.2, 46.5, 45.7, 45.1, 45.4, 44.6, 44.0, 44.3, 43.6, 43.2, 43.5, 42.9, 42.6, 42.8, 42.3],
    ts: '2026-06-16T09:14:00Z',
  },
  {
    id: 'm-conversion',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    key: 'conversion_rate',
    name: 'Conversion Rate',
    value: 3.42,
    display: '3.42%',
    delta: 0.38,
    goodDirection: 'up',
    unit: '%',
    series: [2.9, 2.95, 3.0, 2.98, 3.05, 3.1, 3.08, 3.15, 3.12, 3.2, 3.18, 3.25, 3.3, 3.28, 3.34, 3.38, 3.36, 3.4, 3.42],
    ts: '2026-06-16T09:14:00Z',
  },
  {
    id: 'm-reach',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    key: 'brand_reach',
    name: 'Brand Reach',
    value: 1240000,
    display: '1.24M',
    delta: 8.7,
    goodDirection: 'up',
    unit: 'impressions',
    series: [0.92, 0.95, 0.98, 1.0, 1.03, 1.05, 1.04, 1.08, 1.11, 1.1, 1.14, 1.16, 1.15, 1.19, 1.21, 1.2, 1.23, 1.22, 1.24],
    ts: '2026-06-16T09:14:00Z',
  },
  {
    id: 'm-cac',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    key: 'cac',
    name: 'Cost per Acquisition',
    value: 32.1,
    display: '$32.10',
    delta: -5.2,
    goodDirection: 'down',
    unit: 'USD',
    series: [38.4, 37.9, 38.1, 37.2, 36.6, 36.9, 36.0, 35.4, 35.7, 34.8, 34.2, 34.5, 33.8, 33.3, 33.6, 33.0, 32.6, 32.8, 32.1],
    ts: '2026-06-16T09:14:00Z',
  },
  {
    id: 'm-engagement',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    key: 'engagement_rate',
    name: 'Engagement Rate',
    value: 71.2,
    display: '71.2%',
    delta: 2.3,
    goodDirection: 'up',
    unit: '%',
    series: [64.1, 64.8, 65.2, 65.0, 66.1, 66.7, 66.4, 67.3, 68.0, 67.7, 68.6, 69.2, 68.9, 69.8, 70.3, 70.0, 70.8, 70.6, 71.2],
    ts: '2026-06-16T09:14:00Z',
  },
];

export function getMetrics(loopId: string): Metric[] {
  return METRICS.filter((m) => m.loopId === loopId);
}
