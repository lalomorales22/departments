'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ArtifactKind } from '@departments/shared';
import { FileText, Upload, X } from 'lucide-react';
import { SectionLabel } from '@/components/atoms';
import { useLoops } from '@/lib/loops-client';
import { useLoopInspect } from '@/lib/live';
import { cn } from '@/lib/cn';
import { useCockpit } from '@/lib/store';

const KIND_LABEL: Record<ArtifactKind, string> = {
  readme: 'README',
  tasks: 'TASKS',
  handoff: 'HANDOFF',
  report: 'REPORT',
  strategy: 'STRATEGY',
  source: 'SRC',
  dashboard: 'DASH',
};

/**
 * The ARTIFACTS tab — a cross-loop file & memory browser over each loop's real git
 * workspace (the inspect/artifacts routes). Pick a loop, browse its versioned artifacts,
 * preview a file, and import a new one (⌘I) which writes + commits it. Semantic search +
 * shiki highlighting + version diff are the Phase-5 polish; this is the working browser.
 */
export function ArtifactsView({ loopId }: { loopId: string }) {
  const LOOPS = useLoops();
  const importOpen = useCockpit((s) => s.importOpen);
  const setImportOpen = useCockpit((s) => s.setImportOpen);

  const [browseLoopId, setBrowseLoopId] = useState(loopId);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);

  // Keep the browser in sync when the cockpit's focused loop changes.
  useEffect(() => setBrowseLoopId(loopId), [loopId]);

  const inspect = useLoopInspect(browseLoopId, reloadKey);
  const artifacts = inspect?.artifacts ?? [];
  const memory = inspect?.memory ?? [];

  // Load the selected file's content for preview.
  useEffect(() => {
    if (!selectedPath) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setContent(null);
    void fetch(`/api/loops/${encodeURIComponent(browseLoopId)}/artifacts?path=${encodeURIComponent(selectedPath)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ content: string }>) : null))
      .then((d) => {
        if (!cancelled) setContent(d?.content ?? '(unable to read file)');
      })
      .catch(() => {
        if (!cancelled) setContent('(unable to read file)');
      });
    return () => {
      cancelled = true;
    };
  }, [browseLoopId, selectedPath]);

  const browseLoop = LOOPS.find((l) => l.id === browseLoopId);

  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <SectionLabel>Artifacts — {browseLoop?.displayName ?? browseLoopId}</SectionLabel>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface-2 px-2 py-1 text-2xs uppercase tracking-wider text-muted transition-colors hover:text-text focus-ring"
        >
          <Upload className="h-3 w-3" strokeWidth={2} /> Import <span className="text-faint">⌘I</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[200px_minmax(0,1.2fr)_minmax(0,1.4fr)]">
        {/* Loop picker */}
        <div className="panel max-h-[460px] overflow-y-auto p-1.5">
          <div className="px-1.5 pb-1.5 pt-1">
            <SectionLabel>Loops</SectionLabel>
          </div>
          {LOOPS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setBrowseLoopId(l.id);
                setSelectedPath(null);
              }}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-xs transition-colors focus-ring',
                browseLoopId === l.id ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2/60 hover:text-text',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{l.displayName}</span>
              <span className="shrink-0 font-mono text-2xs text-faint">L{l.level}</span>
            </button>
          ))}
        </div>

        {/* Artifact list */}
        <div className="panel max-h-[460px] overflow-y-auto p-1.5">
          <div className="px-1.5 pb-1.5 pt-1">
            <SectionLabel right={<span className="tabular text-2xs text-faint">{artifacts.length}</span>}>
              Files {inspect ? `· ${inspect.version}` : ''}
            </SectionLabel>
          </div>
          {!inspect ? (
            <p className="px-1.5 py-2 text-2xs text-faint">Loading…</p>
          ) : artifacts.length === 0 ? (
            <p className="px-1.5 py-2 text-2xs text-faint">No artifacts yet — this loop hasn’t run locally. Import one with ⌘I.</p>
          ) : (
            artifacts.map((a) => (
              <button
                key={a.path}
                type="button"
                onClick={() => setSelectedPath(a.path)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left transition-colors focus-ring',
                  selectedPath === a.path ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2/60 hover:text-text',
                )}
              >
                <FileText className="h-3 w-3 shrink-0 text-faint" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate text-xs">{a.path}</span>
                <span className="shrink-0 rounded-sm border border-hairline px-1 font-mono text-[10px] uppercase text-faint">
                  {KIND_LABEL[a.kind]}
                </span>
                <span className="tabular shrink-0 text-2xs text-faint">{a.sizeBytes}B</span>
              </button>
            ))
          )}

          {memory.length > 0 && (
            <>
              <div className="px-1.5 pb-1.5 pt-3">
                <SectionLabel right={<span className="tabular text-2xs text-faint">{memory.length}</span>}>Memory</SectionLabel>
              </div>
              {memory.slice(0, 8).map((m, i) => (
                <div key={i} className="px-1.5 py-1 text-2xs leading-snug text-muted">
                  {m.summary}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Preview */}
        <div className="panel grid-floor max-h-[460px] min-h-[260px] overflow-hidden p-0">
          {selectedPath ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
                <FileText className="h-3.5 w-3.5 text-faint" strokeWidth={1.5} />
                <span className="truncate font-mono text-xs text-text">{selectedPath}</span>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-2xs leading-relaxed text-muted">
                {content ?? 'Loading…'}
              </pre>
            </div>
          ) : (
            <div className="flex h-full min-h-[240px] items-center justify-center p-6 text-center">
              <p className="max-w-xs text-sm text-faint">Select a file to preview its current version.</p>
            </div>
          )}
        </div>
      </div>

      {importOpen && (
        <ImportModal
          loopId={browseLoopId}
          onClose={() => setImportOpen(false)}
          onImported={(path) => {
            setImportOpen(false);
            setReloadKey((k) => k + 1);
            setSelectedPath(path);
          }}
        />
      )}
    </div>
  );
}

function ImportModal({
  loopId,
  onClose,
  onImported,
}: {
  loopId: string;
  onClose: () => void;
  onImported: (path: string) => void;
}) {
  const LOOPS = useLoops();
  const [target, setTarget] = useState(loopId);
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = useMemo(() => path.trim().length > 0 && !path.includes('..'), [path]);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/loops/${encodeURIComponent(target)}/artifacts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: path.trim(), content }),
      });
      if (!res.ok) throw new Error(`import failed (${res.status})`);
      onImported(path.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-bg/70 p-4 pt-24 backdrop-blur-sm" onClick={onClose}>
      <div
        className="panel w-full max-w-lg p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Import artifact"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>Import Artifact</SectionLabel>
          <button type="button" onClick={onClose} aria-label="Close" className="text-faint hover:text-text focus-ring">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <label className="mb-1 block text-2xs uppercase tracking-wider text-faint">Loop</label>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="mb-3 w-full rounded-sm border border-hairline bg-bg-deep px-2 py-1.5 text-xs text-text focus-ring"
        >
          {LOOPS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.displayName} (L{l.level})
            </option>
          ))}
        </select>

        <label className="mb-1 block text-2xs uppercase tracking-wider text-faint">Path</label>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="docs/spec.md"
          className="mb-3 w-full rounded-sm border border-hairline bg-bg-deep px-2 py-1.5 font-mono text-xs text-text focus-ring"
        />

        <label className="mb-1 block text-2xs uppercase tracking-wider text-faint">Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder="# Spec&#10;…"
          className="mb-3 w-full resize-none rounded-sm border border-hairline bg-bg-deep px-2 py-1.5 font-mono text-2xs leading-relaxed text-text focus-ring"
        />

        {error && <p className="mb-2 text-2xs text-accent-red">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-sm border border-hairline px-3 py-1.5 text-2xs uppercase tracking-wider text-muted hover:text-text focus-ring">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || busy}
            className={cn(
              'flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-2xs uppercase tracking-wider transition-colors focus-ring',
              valid && !busy
                ? 'border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20'
                : 'cursor-not-allowed border-hairline text-faint',
            )}
          >
            <Upload className="h-3 w-3" strokeWidth={2} /> {busy ? 'Importing…' : 'Import + commit'}
          </button>
        </div>
      </div>
    </div>
  );
}
