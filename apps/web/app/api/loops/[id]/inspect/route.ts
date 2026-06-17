import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ArtifactKind } from '@departments/shared';
import { sanitizeLoopId } from '@/lib/server/realtime';

// The per-loop git substrate the engine writes to (mirrors @departments/artifacts'
// defaultArtifactsRoot without importing that Node-only package into the bundle).
// Next dev runs with cwd = apps/web; the monorepo root is two levels up.
const REPO_ROOT = resolve(process.cwd(), '..', '..');
const LOOPS_ROOT = process.env.DEPARTMENTS_ARTIFACTS_ROOT ?? join(REPO_ROOT, '.volumes', 'loops');
const MEMORY_ROOT = join(LOOPS_ROOT, '..', 'memory');

function workspaceDir(loopId: string): string {
  return join(LOOPS_ROOT, loopId);
}

/**
 * GET /api/loops/:id/inspect — the loop's REAL inspector payload, read from its
 * per-loop git workspace + memory store: the artifact file tree (with the current
 * version SHA), distilled memory entries, and the latest HANDOFF.md. The Inspector
 * overlays this over fixtures when a loop has actually run locally; otherwise the
 * payload is empty and the UI falls back to fixtures.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const exec = promisify(execFile);

export interface InspectArtifact {
  path: string;
  kind: ArtifactKind;
  sizeBytes: number;
  version: string;
}
export interface InspectMemory {
  path: string;
  summary: string;
}
export interface InspectPayload {
  exists: boolean;
  version: string;
  artifacts: InspectArtifact[];
  memory: InspectMemory[];
  handoff: string | null;
}

const SKIP_DIRS = new Set(['.git', 'node_modules']);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loopId = sanitizeLoopId(id);
  const dir = workspaceDir(loopId);

  let exists = false;
  try {
    exists = (await stat(dir)).isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) {
    return Response.json({ exists: false, version: 'v0', artifacts: [], memory: [], handoff: null } satisfies InspectPayload);
  }

  const version = await headVersion(dir);
  const files = await walk(dir, dir);
  const artifacts: InspectArtifact[] = files.map((f) => ({
    path: f.rel,
    kind: kindOf(f.rel),
    sizeBytes: f.size,
    version,
  }));
  artifacts.sort((a, b) => a.path.localeCompare(b.path));

  const handoff = await readFileOrNull(join(dir, 'HANDOFF.md'));
  const memory = await readMemory(loopId);

  return Response.json({ exists: true, version, artifacts, memory, handoff } satisfies InspectPayload);
}

/** Short HEAD SHA as the version label (or v0 before the first commit). */
async function headVersion(dir: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir });
    return stdout.trim() || 'v0';
  } catch {
    return 'v0';
  }
}

async function walk(dir: string, root: string): Promise<Array<{ rel: string; size: number }>> {
  const out: Array<{ rel: string; size: number }> = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      out.push(...(await walk(join(dir, ent.name), root)));
    } else if (ent.isFile()) {
      const abs = join(dir, ent.name);
      try {
        const s = await stat(abs);
        out.push({ rel: relative(root, abs), size: s.size });
      } catch {
        /* skip unreadable */
      }
    }
  }
  return out;
}

/** Map a workspace path to an artifact kind for the inspector glyph. */
function kindOf(rel: string): ArtifactKind {
  const base = rel.split('/').pop()?.toUpperCase() ?? '';
  if (base === 'README.MD') return 'readme';
  if (base === 'TASKS.MD') return 'tasks';
  if (base === 'HANDOFF.MD') return 'handoff';
  if (base === 'REPORT.MD') return 'report';
  if (base === 'STRATEGY.MD') return 'strategy';
  return 'source';
}

async function readFileOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Read the loop's distilled memory (FileMemoryStore JSONL under .volumes/memory). */
async function readMemory(loopId: string): Promise<InspectMemory[]> {
  const safe = loopId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const out: InspectMemory[] = [];
  try {
    const raw = await readFile(join(MEMORY_ROOT, `${safe}.jsonl`), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const rec = JSON.parse(t) as { path?: string; summary?: string };
        if (typeof rec.summary === 'string') out.push({ path: rec.path ?? '', summary: rec.summary });
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* no memory yet */
  }
  return out;
}
