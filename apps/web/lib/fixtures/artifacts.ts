import type { Artifact } from '@departments/shared';
import { ORG } from './loops';

/** Five artifacts for marketing — the files-as-memory set (the inspector ARTIFACTS list). */
export const ARTIFACTS: Artifact[] = [
  {
    id: 'art-readme',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    kind: 'readme',
    path: 'README.md',
    version: 'v4',
    sizeBytes: 8240,
    updatedAt: '2026-06-01T10:00:00Z',
  },
  {
    id: 'art-tasks',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    kind: 'tasks',
    path: 'TASKS.md',
    version: 'v47',
    sizeBytes: 6110,
    updatedAt: '2026-06-16T09:02:00Z',
  },
  {
    id: 'art-handoff',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    kind: 'handoff',
    path: 'HANDOFF.md',
    version: 'v47',
    sizeBytes: 3380,
    updatedAt: '2026-06-16T09:14:00Z',
  },
  {
    id: 'art-report',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    kind: 'report',
    path: 'REPORT.md',
    version: 'v46',
    sizeBytes: 5020,
    updatedAt: '2026-06-15T21:40:00Z',
  },
  {
    id: 'art-strategy',
    orgId: ORG.id,
    loopId: 'loop-marketing',
    kind: 'strategy',
    path: 'STRATEGY.md',
    version: 'v6',
    sizeBytes: 4470,
    updatedAt: '2026-06-08T09:30:00Z',
  },
];

export function getArtifacts(loopId: string): Artifact[] {
  return ARTIFACTS.filter((a) => a.loopId === loopId);
}
