import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { sanitizeLoopId } from '@/lib/server/realtime';

/**
 * Cross-loop ARTIFACTS read/write for the ARTIFACTS tab.
 *   GET  /api/loops/:id/artifacts?path=REPORT.md → that file's text content (preview).
 *   POST /api/loops/:id/artifacts  { path, content } → the ⌘I "Import Artifact" flow:
 *        writes the file into the loop's git workspace and commits it (a versioned
 *        Artifact + git commit), the local stand-in for the prod import pipeline.
 *
 * Both resolve paths INSIDE the loop's workspace only (no `..`/absolute traversal),
 * mirroring the inspect route's REPO_ROOT/LOOPS_ROOT discipline.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const exec = promisify(execFile);
const REPO_ROOT = resolve(process.cwd(), '..', '..');
const LOOPS_ROOT = process.env.DEPARTMENTS_ARTIFACTS_ROOT ?? join(REPO_ROOT, '.volumes', 'loops');

function workspaceDir(loopId: string): string {
  return join(LOOPS_ROOT, loopId);
}

/** Resolve a workspace-relative path, refusing anything that escapes the workspace. */
function safeAbs(dir: string, rel: string): string | null {
  const abs = resolve(dir, rel);
  if (abs !== dir && !abs.startsWith(dir + '/')) return null;
  return abs;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loopId = sanitizeLoopId(id);
  const rel = new URL(req.url).searchParams.get('path');
  if (!rel) return Response.json({ error: 'path required' }, { status: 400 });
  const abs = safeAbs(workspaceDir(loopId), rel);
  if (!abs) return Response.json({ error: 'invalid path' }, { status: 400 });
  try {
    const content = await readFile(abs, 'utf8');
    return Response.json({ path: rel, content });
  } catch {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loopId = sanitizeLoopId(id);
  let body: { path?: unknown; content?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const rel = typeof body.path === 'string' ? body.path.trim() : '';
  const content = typeof body.content === 'string' ? body.content : '';
  if (!rel) return Response.json({ error: 'path required' }, { status: 400 });

  const dir = workspaceDir(loopId);
  const abs = safeAbs(dir, rel);
  if (!abs) return Response.json({ error: 'invalid path' }, { status: 400 });

  // Ensure the loop has an isolated git repo (create on first import).
  await mkdir(dir, { recursive: true });
  try {
    await stat(join(dir, '.git'));
  } catch {
    await exec('git', ['init', '-b', 'main'], { cwd: dir });
    await exec('git', ['config', 'user.name', 'Departments Loop'], { cwd: dir });
    await exec('git', ['config', 'user.email', 'loop@departments.local'], { cwd: dir });
  }

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
  await exec('git', ['add', '--', rel], { cwd: dir });
  try {
    await exec('git', ['commit', '-m', `import: ${rel}`], { cwd: dir });
  } catch {
    /* nothing staged (identical content) — not an error */
  }
  let version = 'v0';
  try {
    version = (await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir })).stdout.trim() || 'v0';
  } catch {
    /* no commits yet */
  }
  return Response.json({ ok: true, path: rel, version });
}
