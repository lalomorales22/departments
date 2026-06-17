/**
 * In-memory / temp-dir port adapters. Used by the engine test suite AND as a
 * dependency-free fallback driver (the local-driver swaps in the real git/pgvector
 * adapters). Kept deterministic where it matters.
 */
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DeptEvent } from '@departments/events';
import type { RubricCategory, TokenUsage } from '@departments/shared';
import type {
  ArtifactPort,
  ArtifactSnapshot,
  CapAction,
  LedgerPort,
  MemoryPort,
  PersistencePort,
  RubricPort,
  RunRecord,
} from './ports.js';

/** A temp-dir-backed artifact store that computes diffs by content comparison. */
export function makeTempArtifacts(): ArtifactPort & { dir(): string } {
  let workspaceDir = '';
  let version = 0;
  let last = new Map<string, string>();

  async function scan(dir: string, baseRel = ''): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const ent of entries) {
      if (ent.name === '.git') continue;
      const rel = baseRel ? `${baseRel}/${ent.name}` : ent.name;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        for (const [k, v] of await scan(abs, rel)) out.set(k, v);
      } else {
        out.set(rel, await readFile(abs, 'utf8'));
      }
    }
    return out;
  }

  return {
    dir: () => workspaceDir,
    async provision(loopId) {
      if (!workspaceDir) workspaceDir = await mkdtemp(join(tmpdir(), `dept-${loopId}-`));
      return { workspaceDir };
    },
    async seedIfEmpty(_loopId, seeds) {
      for (const [rel, content] of Object.entries(seeds)) {
        const abs = join(workspaceDir, rel);
        try {
          await readFile(abs, 'utf8');
        } catch {
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, content, 'utf8');
        }
      }
      last = await scan(workspaceDir);
    },
    async read(_loopId, rel) {
      try {
        return await readFile(join(workspaceDir, rel), 'utf8');
      } catch {
        return null;
      }
    },
    async snapshot(_loopId, _meta): Promise<ArtifactSnapshot> {
      const cur = await scan(workspaceDir);
      const changedFiles: string[] = [];
      for (const [k, v] of cur) if (last.get(k) !== v) changedFiles.push(k);
      last = cur;
      version += 1;
      const meaningful = changedFiles.some((f) => f !== 'HANDOFF.md');
      return { sha: `mem-sha-${version}`, version: `v${version}`, changedFiles, meaningful };
    },
  };
}

export function makeMemoryStore(): MemoryPort & { all(): Array<{ path: string; summary: string }> } {
  const store: Array<{ path: string; summary: string }> = [];
  return {
    all: () => store,
    async query(_loopId, _q, k) {
      return store.slice(-k).map((e, i) => ({ path: e.path, summary: e.summary, relevance: 0.9 - i * 0.1 }));
    },
    async append(_loopId, entry) {
      store.push(entry);
    },
  };
}

export function makeRubrics(): RubricPort {
  return {
    criteria(): Record<RubricCategory, string> {
      return {
        quality: 'Standards met; outputs correct and complete.',
        data_validation: 'Facts, numbers, and claims are accurate.',
        alignment_risk: 'On-mission, safe, and within policy.',
        performance: 'Measured against the success metrics.',
      };
    },
  };
}

const PRICES: Record<string, [number, number]> = {
  'claude-opus-4-8': [5, 25],
  'claude-fable-5': [10, 50],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
};

export function makeLedger(opts: { hardCapUsd?: number; softFraction?: number } = {}): LedgerPort & {
  spent(): number;
} {
  const hard = opts.hardCapUsd ?? Number.POSITIVE_INFINITY;
  const softFraction = opts.softFraction ?? 0.8;
  let spent = 0;
  return {
    spent: () => spent,
    recordUsage(_scope, usage: TokenUsage, modelId) {
      const [pin, pout] = PRICES[modelId] ?? [3, 15];
      const inCost = (usage.inputTokens * pin + usage.cacheReadInputTokens * pin * 0.1) / 1_000_000;
      const outCost = (usage.outputTokens * pout) / 1_000_000;
      const costUsd = inCost + outCost;
      spent += costUsd;
      return { costUsd };
    },
    checkCap(): CapAction {
      if (spent >= hard) return 'pause';
      if (spent >= hard * softFraction) return 'downgrade';
      return 'ok';
    },
  };
}

export function makePersistence(): PersistencePort & { events: DeptEvent[]; runs: RunRecord[] } {
  const seqs = new Map<string, number>();
  const events: DeptEvent[] = [];
  const runs: RunRecord[] = [];
  return {
    events,
    runs,
    nextSeq(loopId) {
      const n = seqs.get(loopId) ?? 0;
      seqs.set(loopId, n + 1);
      return n;
    },
    recordEvent(e) {
      events.push(e);
    },
    recordRun(r) {
      runs.push(r);
    },
  };
}
