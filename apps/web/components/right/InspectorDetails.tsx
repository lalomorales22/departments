'use client';

import { useMemo, useState } from 'react';
import {
  BarChart3,
  Compass,
  FileText,
  GitCommitHorizontal,
  ListChecks,
  Search,
} from 'lucide-react';
import type { Artifact, ArtifactKind, MemoryItem } from '@departments/shared';
import { RUBRIC_CATEGORY_LABELS } from '@departments/shared';
import {
  getArtifacts,
  getGates,
  getLoop,
  getMemory,
} from '@/lib/fixtures';
import { useLiveMetrics, useLoopInspect } from '@/lib/live';
import { accentVar, rubricAccent } from '@/lib/status-theme';
import { DeltaChip, SectionLabel, Sparkline } from '@/components/atoms';

/** Map an artifact kind to its thin lucide glyph. */
const ARTIFACT_ICON: Record<ArtifactKind, typeof FileText> = {
  readme: FileText,
  tasks: ListChecks,
  handoff: GitCommitHorizontal,
  report: BarChart3,
  strategy: Compass,
  source: FileText,
  dashboard: BarChart3,
};

/** Human-readable byte size (machine-emitted → mono at call site). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** A hairline-separated section block. */
function Block({
  label,
  right,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-hairline px-3 py-3">
      <SectionLabel right={right}>{label}</SectionLabel>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

export function InspectorDetails({ loopId }: { loopId: string }) {
  const loop = getLoop(loopId);
  const { metrics } = useLiveMetrics(loopId);
  const gates = getGates(loopId);
  const inspect = useLoopInspect(loopId);

  // Prefer REAL artifacts/memory from the loop's git workspace; fall back to fixtures
  // when the loop has never run locally.
  const artifacts: Artifact[] = useMemo(() => {
    if (inspect?.exists && inspect.artifacts.length > 0) {
      return inspect.artifacts.map((a, i) => ({
        id: `live-art-${loopId}-${i}`,
        orgId: 'org-local',
        loopId,
        kind: a.kind,
        path: a.path,
        version: a.version,
        sizeBytes: a.sizeBytes,
        updatedAt: '',
      }));
    }
    return getArtifacts(loopId);
  }, [inspect, loopId]);

  const memory: MemoryItem[] = useMemo(() => {
    if (inspect?.exists && inspect.memory.length > 0) {
      return inspect.memory.map((m, i) => ({
        id: `live-mem-${loopId}-${i}`,
        orgId: 'org-local',
        loopId,
        path: m.path,
        summary: m.summary,
        createdAt: '',
      }));
    }
    return getMemory(loopId);
  }, [inspect, loopId]);

  const [query, setQuery] = useState('');
  const filteredMemory = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return memory;
    return memory.filter((m) => m.summary.toLowerCase().includes(q));
  }, [memory, query]);

  return (
    <div className="animate-fade-in">
      {/* MISSION */}
      <Block label="Mission">
        <p className="text-sm leading-relaxed text-muted">
          {loop?.mission ?? 'No mission defined.'}
        </p>
      </Block>

      {/* SUCCESS METRICS */}
      <Block
        label="Success Metrics"
        right={<span className="tabular text-2xs text-faint">{metrics.length}</span>}
      >
        {metrics.length === 0 ? (
          <p className="text-2xs text-faint">No metrics tracked.</p>
        ) : (
          <ul className="flex flex-col">
            {metrics.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-2 border-b border-hairline/60 py-1.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-text">{m.name}</span>
                <Sparkline data={m.series} accent="cyan" width={70} height={16} fill={false} />
                <span className="tabular w-16 shrink-0 text-right text-xs text-text">
                  {m.display}
                </span>
                <span className="flex w-14 shrink-0 justify-end">
                  <DeltaChip delta={m.delta} goodDirection={m.goodDirection} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* GATES */}
      <Block
        label="Gates"
        right={
          <span className="tabular text-2xs text-faint">
            {gates.filter((g) => g.passed).length}/{gates.length} PASS
          </span>
        }
      >
        <ul className="flex flex-col gap-1">
          {gates.map((g) => {
            const accent = g.passed ? rubricAccent[g.category] : 'red';
            return (
              <li
                key={g.category}
                className="flex items-center gap-2 rounded-sm border border-hairline bg-surface-2 px-2 py-1.5"
              >
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: accentVar(accent) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-xs text-muted">
                  {RUBRIC_CATEGORY_LABELS[g.category]}
                </span>
                <span
                  className="tabular text-xs"
                  style={{ color: accentVar(accent) }}
                >
                  {g.score}
                </span>
                <span className="tabular text-2xs text-faint">
                  {g.passed ? 'PASS' : 'FAIL'}
                </span>
              </li>
            );
          })}
        </ul>
      </Block>

      {/* ARTIFACTS */}
      <Block
        label="Artifacts"
        right={<span className="tabular text-2xs text-faint">{artifacts.length}</span>}
      >
        {artifacts.length === 0 ? (
          <p className="text-2xs text-faint">No artifacts.</p>
        ) : (
          <ul className="flex flex-col">
            {artifacts.map((a) => {
              const Icon = ARTIFACT_ICON[a.kind];
              return (
                <li
                  key={a.id}
                  className="flex items-center gap-2 border-b border-hairline/60 py-1.5 last:border-0"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.5} />
                  <span className="tabular min-w-0 flex-1 truncate text-xs text-text">
                    {a.path}
                  </span>
                  <span className="tabular shrink-0 rounded-sm border border-hairline bg-surface-2 px-1 text-2xs text-muted">
                    {a.version}
                  </span>
                  <span className="tabular w-14 shrink-0 text-right text-2xs text-faint">
                    {formatBytes(a.sizeBytes)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      {/* CONTEXT / MEMORY */}
      <Block
        label="Context / Memory"
        right={
          <span className="tabular text-2xs text-faint">
            {filteredMemory.length}/{memory.length}
          </span>
        }
      >
        <div className="relative mb-2.5">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
            strokeWidth={1.5}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter memory…"
            aria-label="Filter memory entries"
            className="focus-ring w-full rounded-sm border border-hairline bg-bg-deep py-1.5 pl-7 pr-2 font-mono text-2xs text-text placeholder:text-faint"
          />
        </div>

        {filteredMemory.length === 0 ? (
          <p className="text-2xs text-faint">No matching memory entries.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filteredMemory.map((m) => {
              const relevance = m.relevance ?? 0;
              return (
                <li
                  key={m.id}
                  className="rounded-sm border border-hairline bg-surface-2 px-2 py-1.5"
                >
                  <p className="text-xs leading-snug text-text">{m.summary}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="tabular min-w-0 truncate text-2xs text-faint">
                      {m.path}
                    </span>
                    <span className="tabular shrink-0 text-2xs text-faint">
                      {(relevance * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-bg-deep">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(0, Math.min(1, relevance)) * 100}%`,
                        backgroundColor: accentVar('cyan'),
                      }}
                      aria-hidden
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Block>
    </div>
  );
}
