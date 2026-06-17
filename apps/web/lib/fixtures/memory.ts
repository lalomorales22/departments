import type { MemoryItem } from '@departments/shared';
import { ORG } from './loops';

/** Five distilled memory entries for marketing (the inspector's CONTEXT / MEMORY). */
export const MEMORY: MemoryItem[] = [
  {
    id: 'mem-1',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    path: 'HANDOFF.md#decisions',
    summary: 'Short-form video out-converts static by 2.4× on paid — shift 40% of creative budget to video.',
    contentRef: 'sha:9af2c1',
    relevance: 0.94,
    createdAt: '2026-06-15T21:40:00Z',
  },
  {
    id: 'mem-2',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    path: 'REPORT.md#cycle-46',
    summary: 'Tuesday 10am PT sends beat all other windows by 18% open rate; lock as the default send time.',
    contentRef: 'sha:71be40',
    relevance: 0.88,
    createdAt: '2026-06-14T18:05:00Z',
  },
  {
    id: 'mem-3',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    path: 'memory/insights/seo.md',
    summary: '"managed IT services san diego" is high-intent, low-difficulty — prioritize a pillar page.',
    contentRef: 'sha:0cc9d2',
    relevance: 0.83,
    createdAt: '2026-06-12T15:20:00Z',
  },
  {
    id: 'mem-4',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    path: 'memory/insights/brand.md',
    summary: 'Comedeez audience skews 18–24; humor-first hooks in the first 2s retain 3× longer.',
    contentRef: 'sha:4d1aa8',
    relevance: 0.79,
    createdAt: '2026-06-10T12:00:00Z',
  },
  {
    id: 'mem-5',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    path: 'STRATEGY.md#guardrails',
    summary: 'CEO objective: hold CAC under $35 while growing qualified traffic 10%+ MoM.',
    contentRef: 'sha:b32f57',
    relevance: 0.76,
    createdAt: '2026-06-08T09:30:00Z',
  },
];

export function getMemory(loopId: string): MemoryItem[] {
  return MEMORY.filter((m) => m.loopId === loopId);
}
