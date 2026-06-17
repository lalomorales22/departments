import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitArtifactStore, sanitizeTag } from './git-store';

const exec = promisify(execFile);

const LOOP = 'software-builder';
const SEEDS = {
  'README.md': '# software-builder\n',
  'TASKS.md': '## Phase 1\n',
  'HANDOFF.md': 'cycle 0\n',
};

/** Count commits reachable from HEAD; 0 when the repo has none. */
async function commitCount(dir: string): Promise<number> {
  try {
    const { stdout } = await exec('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' });
    return Number(stdout.trim());
  } catch {
    return 0;
  }
}

/** List all tags in the repo. */
async function tags(dir: string): Promise<string[]> {
  const { stdout } = await exec('git', ['tag', '--list'], { cwd: dir, encoding: 'utf8' });
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

describe('GitArtifactStore', () => {
  let root: string;
  let store: GitArtifactStore;
  let dir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dept-artifacts-test-'));
    store = new GitArtifactStore({ root });
    dir = store.workspaceDir(LOOP);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('provisions a git repo and seeds README/TASKS/HANDOFF with an initial commit', async () => {
    const { workspaceDir } = await store.provision(LOOP);
    expect(workspaceDir).toBe(dir);
    expect(await commitCount(dir)).toBe(0);

    await store.seedIfEmpty(LOOP, SEEDS);

    // A commit now exists with the seeded files readable through the port.
    expect(await commitCount(dir)).toBe(1);
    expect(await store.read(LOOP, 'README.md')).toBe(SEEDS['README.md']);
    expect(await store.read(LOOP, 'TASKS.md')).toBe(SEEDS['TASKS.md']);
    expect(await store.read(LOOP, 'missing.md')).toBeNull();
  });

  it('does not re-seed existing files and is idempotent on a second seed call', async () => {
    await store.provision(LOOP);
    await store.seedIfEmpty(LOOP, SEEDS);
    // Mutate README after seeding; a second seed must NOT overwrite it...
    await writeFile(join(dir, 'README.md'), 'edited\n', 'utf8');
    await store.seedIfEmpty(LOOP, SEEDS);
    expect(await store.read(LOOP, 'README.md')).toBe('edited\n');
    // ...and must not create a second commit (repo already had commits).
    expect(await commitCount(dir)).toBe(1);
  });

  it('snapshots a new source file: changedFiles includes it, meaningful, tag created', async () => {
    await store.provision(LOOP);
    await store.seedIfEmpty(LOOP, SEEDS);

    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'app.ts'), 'export const x = 1;\n', 'utf8');

    const snap = await store.snapshot(LOOP, { runId: 'run-1', phase: 'execute', message: 'feat: add app' });

    expect(snap.changedFiles).toContain('src/app.ts');
    expect(snap.meaningful).toBe(true);
    expect(snap.sha).not.toBe('');
    expect(snap.version).toBe('v2'); // seed + this commit
    expect(await commitCount(dir)).toBe(2);

    const expectedTag = sanitizeTag(LOOP, 'run-1', 'execute');
    expect(expectedTag).toBe('software-builder/run-1/execute');
    expect(await tags(dir)).toContain(expectedTag);
  });

  it('snapshot with no changes: empty changedFiles, not meaningful, no new commit', async () => {
    await store.provision(LOOP);
    await store.seedIfEmpty(LOOP, SEEDS);
    const before = await commitCount(dir);

    const snap = await store.snapshot(LOOP, { runId: 'run-2', phase: 'evaluate', message: 'noop' });

    expect(snap.changedFiles).toEqual([]);
    expect(snap.meaningful).toBe(false);
    expect(snap.sha).toBe('');
    expect(await commitCount(dir)).toBe(before); // no empty commit
    expect(await tags(dir)).not.toContain(sanitizeTag(LOOP, 'run-2', 'evaluate'));
  });

  it('snapshot that touches ONLY HANDOFF.md is committed but NOT meaningful', async () => {
    await store.provision(LOOP);
    await store.seedIfEmpty(LOOP, SEEDS);
    const before = await commitCount(dir);

    await writeFile(join(dir, 'HANDOFF.md'), 'cycle 1\n', 'utf8');
    const snap = await store.snapshot(LOOP, { runId: 'run-3', phase: 'memory', message: 'handoff' });

    expect(snap.changedFiles).toEqual(['HANDOFF.md']);
    expect(snap.meaningful).toBe(false); // HANDOFF.md is excluded from the meaningful test
    expect(await commitCount(dir)).toBe(before + 1); // a real diff exists, so it commits
  });

  it('a snapshot mixing HANDOFF.md with real work is meaningful', async () => {
    await store.provision(LOOP);
    await store.seedIfEmpty(LOOP, SEEDS);

    await writeFile(join(dir, 'HANDOFF.md'), 'cycle 1\n', 'utf8');
    await writeFile(join(dir, 'REPORT.md'), 'learnings\n', 'utf8');
    const snap = await store.snapshot(LOOP, { runId: 'run-4', phase: 'memory', message: 'cycle 1' });

    expect(snap.changedFiles).toEqual(expect.arrayContaining(['HANDOFF.md', 'REPORT.md']));
    expect(snap.meaningful).toBe(true);
  });

  it('provision is idempotent: re-provisioning an existing repo keeps its history', async () => {
    await store.provision(LOOP);
    await store.seedIfEmpty(LOOP, SEEDS);
    await store.provision(LOOP); // must not re-init or wipe
    expect(await commitCount(dir)).toBe(1);
  });

  it('sanitizeTag replaces illegal ref characters and never emits a colon', () => {
    const tag = sanitizeTag('org:loop', 'run:42', 'plan');
    expect(tag).not.toContain(':');
    expect(tag).toBe('org_loop/run_42/plan');
  });
});
