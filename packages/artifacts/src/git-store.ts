/**
 * GitArtifactStore — a REAL git-backed ArtifactPort (files-as-memory).
 *
 * Each loop gets its own git repository at `<root>/<loopId>`. Phases snapshot the
 * working tree as a commit, tag it, and report whether the change was MEANINGFUL —
 * the signal the no-progress detector relies on. Because HANDOFF.md is rewritten on
 * EVERY cycle (so a diff always exists), it is explicitly excluded from the
 * meaningful test; otherwise the detector would be defeated by design.
 *
 * Structurally satisfies `@departments/orchestration`'s `ArtifactPort` without taking
 * a dependency on it: the engine consumes this via the port interface at the
 * composition root. The shapes here are kept byte-identical to the port contract.
 *
 * All git invocations go through promisified `execFile` with `cwd` set to the loop's
 * workspace and arguments passed as an argv array — never a shell string — so a
 * loopId/runId/phase can never be shell-interpolated.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Phase } from '@departments/shared';

const exec = promisify(execFile);

/** Git SHA + version label + the paths a snapshot touched. */
export interface ArtifactSnapshot {
  /** Short HEAD SHA of the commit (empty string when nothing was committed). */
  sha: string;
  /** Human version label, `v<totalCommitCount>`. */
  version: string;
  /** Paths changed by this snapshot, relative to the workspace. */
  changedFiles: string[];
  /**
   * Whether the change is MEANINGFUL — at least one changed path that is NOT the
   * always-rewritten HANDOFF.md. Feeds the no-progress detector.
   */
  meaningful: boolean;
}

/** Metadata describing the phase that produced a snapshot. */
export interface SnapshotMeta {
  runId: string;
  phase: Phase;
  message: string;
}

/** Files-as-memory in a per-loop git repo (structurally an `ArtifactPort`). */
export interface ArtifactPortShape {
  provision(loopId: string): Promise<{ workspaceDir: string }>;
  seedIfEmpty(loopId: string, seeds: Record<string, string>): Promise<void>;
  read(loopId: string, rel: string): Promise<string | null>;
  snapshot(loopId: string, meta: SnapshotMeta): Promise<ArtifactSnapshot>;
}

export interface GitArtifactStoreOptions {
  /**
   * Base directory under which each loop gets its own repo at `<root>/<loopId>`.
   * Defaults to `DEPARTMENTS_ARTIFACTS_ROOT`, then the repo's `.volumes/loops`.
   */
  root?: string;
}

/**
 * The always-rewritten handoff artifact. A change to ONLY this file is never
 * meaningful (the README guardrail: it must not defeat the no-progress detector).
 */
const HANDOFF = 'HANDOFF.md';

/**
 * Resolve the default artifacts root: an explicit env override, else the repo's
 * `.volumes/loops` directory (the canonical per-loop git substrate, kept out of
 * version control). Exported for the composition root / tests.
 */
export function defaultArtifactsRoot(): string {
  return (
    process.env.DEPARTMENTS_ARTIFACTS_ROOT ??
    join('/Users/megabrain/Desktop/departments', '.volumes', 'loops')
  );
}

/**
 * TAG SCHEME. Git refs forbid the `:` character, so the engine's logical tag id
 * `loopId:runId:phase` is encoded as the slash-joined path `loopId/runId/phase`
 * (`:` -> `/`). Each of the three components is independently sanitized by
 * {@link sanitizeRefComponent} to an allowlist of `[A-Za-z0-9._-]` (every other
 * character -> `_`), so an arbitrary loopId/runId can never produce an invalid or
 * ambiguous ref. That same per-component sanitizer also guards the on-disk
 * `<root>/<loopId>` path against traversal (no `/`, no `..`, no absolute component
 * survives). Documented here as the canonical scheme.
 */
export function sanitizeTag(loopId: string, runId: string, phase: Phase): string {
  return [loopId, runId, phase].map(sanitizeRefComponent).join('/');
}

function sanitizeRefComponent(raw: string): string {
  const cleaned = raw
    // Allowlist word chars, dot, dash; everything else (incl. ':', '/', '\',
    // whitespace, '~^?*[]@') becomes '_'.
    .replace(/[^A-Za-z0-9._-]/g, '_')
    // '..' is forbidden in refs and is the path-traversal token on disk.
    .replace(/\.{2,}/g, '_')
    // Refs/paths may not begin or end with a dot.
    .replace(/^\.+/, '_')
    .replace(/\.+$/, '_');
  return cleaned.length > 0 ? cleaned : '_';
}

export class GitArtifactStore implements ArtifactPortShape {
  private readonly root: string;

  constructor(opts: GitArtifactStoreOptions = {}) {
    const r = opts.root ?? defaultArtifactsRoot();
    this.root = isAbsolute(r) ? r : resolve(process.cwd(), r);
  }

  /** Absolute path to a loop's repo (does not create it). */
  workspaceDir(loopId: string): string {
    return join(this.root, sanitizeRefComponent(loopId));
  }

  /** Ensure a git working tree exists for the loop; returns its absolute path. */
  async provision(loopId: string): Promise<{ workspaceDir: string }> {
    const workspaceDir = this.workspaceDir(loopId);
    await mkdir(workspaceDir, { recursive: true });
    if (!(await this.hasGitDir(workspaceDir))) {
      // `-b main` keeps the initial branch deterministic regardless of host config.
      await this.git(workspaceDir, ['init', '-b', 'main']);
    }
    // Set a local identity so commits succeed in CI / fresh containers with no
    // global git config. Local config never leaks beyond this repo.
    await this.git(workspaceDir, ['config', 'user.name', 'Departments Loop']);
    await this.git(workspaceDir, ['config', 'user.email', 'loop@departments.local']);
    return { workspaceDir };
  }

  /** Seed files on cold start (only writes missing files); initial commit if empty. */
  async seedIfEmpty(loopId: string, seeds: Record<string, string>): Promise<void> {
    const workspaceDir = this.workspaceDir(loopId);
    for (const [rel, content] of Object.entries(seeds)) {
      const abs = join(workspaceDir, rel);
      if (!(await this.fileExists(abs))) {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
      }
    }
    if (!(await this.hasCommits(workspaceDir))) {
      await this.git(workspaceDir, ['add', '-A']);
      if (await this.hasStaged(workspaceDir)) {
        await this.git(workspaceDir, ['commit', '-m', 'chore: seed artifacts']);
      }
    }
  }

  /** Read an artifact's text, or null if absent. */
  async read(loopId: string, rel: string): Promise<string | null> {
    try {
      return await readFile(join(this.workspaceDir(loopId), rel), 'utf8');
    } catch {
      return null;
    }
  }

  /** Commit the working tree, tag it, and return the snapshot. */
  async snapshot(loopId: string, meta: SnapshotMeta): Promise<ArtifactSnapshot> {
    const workspaceDir = this.workspaceDir(loopId);
    await this.git(workspaceDir, ['add', '-A']);

    // Nothing staged -> no empty commit; report an empty, non-meaningful snapshot.
    if (!(await this.hasStaged(workspaceDir))) {
      return { sha: '', version: await this.version(workspaceDir), changedFiles: [], meaningful: false };
    }

    await this.git(workspaceDir, ['commit', '-m', meta.message]);

    const tag = sanitizeTag(loopId, meta.runId, meta.phase);
    // `-f` keeps snapshot idempotent if a replayed tick reuses the same (runId,phase).
    await this.git(workspaceDir, ['tag', '-f', tag]);

    const changedFiles = await this.changedFilesAtHead(workspaceDir);
    const meaningful = changedFiles.some((f) => f !== HANDOFF);
    const sha = (await this.git(workspaceDir, ['rev-parse', '--short', 'HEAD'])).trim();
    return { sha, version: await this.version(workspaceDir), changedFiles, meaningful };
  }

  // -- git helpers -------------------------------------------------------------

  private async git(cwd: string, args: readonly string[]): Promise<string> {
    const { stdout } = await exec('git', [...args], { cwd, encoding: 'utf8' });
    return stdout;
  }

  /**
   * Whether THIS directory is its own git repo. We deliberately check for a local
   * `.git` entry rather than `git rev-parse --is-inside-work-tree`, because the latter
   * returns `true` when `<root>` happens to live inside an OUTER repo (e.g. the
   * monorepo's own .volumes) — which would make every loop commit leak into the parent
   * repo. Checking for a local `.git` guarantees each loop gets an ISOLATED repo.
   */
  private async hasGitDir(workspaceDir: string): Promise<boolean> {
    try {
      await stat(join(workspaceDir, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  private async hasCommits(workspaceDir: string): Promise<boolean> {
    try {
      await this.git(workspaceDir, ['rev-parse', '--verify', 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  /** True when `git add` has staged at least one change (exit 1 = staged diff). */
  private async hasStaged(workspaceDir: string): Promise<boolean> {
    try {
      await this.git(workspaceDir, ['diff', '--cached', '--quiet']);
      return false; // exit 0 -> no staged changes
    } catch {
      return true; // non-zero -> staged changes present
    }
  }

  /** Files touched by the HEAD commit, relative to the workspace. */
  private async changedFilesAtHead(workspaceDir: string): Promise<string[]> {
    const out = await this.git(workspaceDir, [
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      'HEAD',
    ]);
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  /** `v<totalCommitCount>` (v0 before the first commit). */
  private async version(workspaceDir: string): Promise<string> {
    try {
      const out = (await this.git(workspaceDir, ['rev-list', '--count', 'HEAD'])).trim();
      return `v${out}`;
    } catch {
      return 'v0';
    }
  }

  private async fileExists(abs: string): Promise<boolean> {
    try {
      await readFile(abs, 'utf8');
      return true;
    } catch {
      return false;
    }
  }
}
