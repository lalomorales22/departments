/**
 * MemoryPort implementations backed by the local stand-in embedder.
 *
 * Both stores satisfy the engine's `MemoryPort` shape (see
 * `packages/orchestration/src/ports.ts`) — we restate the structural contract
 * here rather than importing it, so this package has no dependency on the
 * orchestration engine (the engine depends on the *shape*, not on this module).
 *
 *   query(loopId, q, k): rank that loop's stored entries by
 *     cosineSim(embed(q), embed(summary)) descending, return the top-k as
 *     MemoryHit with relevance = the similarity (clamped to 0..1).
 *   append(loopId, entry): persist { path, summary } (plus its embedding).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cosineSim, embed } from './embed';

// ── Port contract (structural mirror of the engine's MemoryPort) ──────────────

export interface MemoryHit {
  path: string;
  summary: string;
  /** 0–1 relevance to the query. */
  relevance: number;
}

export interface MemoryPort {
  /** Semantic/keyword recall for PLAN (top-k). */
  query(loopId: string, q: string, k: number): Promise<MemoryHit[]>;
  /** Persist a distilled insight (MEMORY phase). */
  append(loopId: string, entry: { path: string; summary: string }): Promise<void>;
}

/** A stored memory entry: the insight plus its precomputed embedding. */
interface StoredEntry {
  path: string;
  summary: string;
  embedding: number[];
}

/** Clamp a similarity into the documented 0..1 relevance band. */
function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Rank entries for a query and return the top-k as MemoryHits. Shared by both
 * stores so ranking semantics stay identical. `k <= 0` yields an empty list.
 */
function rank(entries: readonly StoredEntry[], q: string, k: number): MemoryHit[] {
  if (k <= 0 || entries.length === 0) return [];
  const qv = embed(q);
  return entries
    .map((e) => ({ path: e.path, summary: e.summary, relevance: clamp01(cosineSim(qv, e.embedding)) }))
    // Stable-ish: highest relevance first; ties keep insertion order via index.
    .map((hit, index) => ({ hit, index }))
    .sort((a, b) => (b.hit.relevance - a.hit.relevance) || (a.index - b.index))
    .slice(0, k)
    .map(({ hit }) => hit);
}

// ── In-memory store ───────────────────────────────────────────────────────────

/**
 * Process-local MemoryPort. Entries are partitioned per loop. Useful as a
 * dependency-free fallback and in unit tests.
 */
export class InMemoryMemoryStore implements MemoryPort {
  private readonly byLoop = new Map<string, StoredEntry[]>();

  query(loopId: string, q: string, k: number): Promise<MemoryHit[]> {
    const entries = this.byLoop.get(loopId) ?? [];
    return Promise.resolve(rank(entries, q, k));
  }

  append(loopId: string, entry: { path: string; summary: string }): Promise<void> {
    const list = this.byLoop.get(loopId);
    const stored: StoredEntry = {
      path: entry.path,
      summary: entry.summary,
      embedding: embed(entry.summary),
    };
    if (list) list.push(stored);
    else this.byLoop.set(loopId, [stored]);
    return Promise.resolve();
  }
}

// ── File-backed store (JSONL, persists across instances) ──────────────────────

/** One line of the JSONL file. Embeddings are persisted to avoid recomputation. */
interface JsonlRecord {
  path: string;
  summary: string;
  embedding: number[];
}

function isJsonlRecord(v: unknown): v is JsonlRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['path'] === 'string' &&
    typeof r['summary'] === 'string' &&
    Array.isArray(r['embedding']) &&
    (r['embedding'] as unknown[]).every((n) => typeof n === 'number')
  );
}

/**
 * MemoryPort persisted as append-only JSONL under `<dir>/<loopId>.jsonl`. Each
 * `append` writes one line; `query` reads the file and ranks. Because state
 * lives on disk, a fresh `FileMemoryStore` pointed at the same dir sees every
 * previously appended entry (round-trips across instances).
 *
 * Loop ids are sanitized for use as filenames so path traversal / separators in
 * a loop id cannot escape the base directory.
 */
export class FileMemoryStore implements MemoryPort {
  constructor(private readonly dir: string) {}

  private fileFor(loopId: string): string {
    const safe = loopId.replace(/[^a-zA-Z0-9._-]/gu, '_') || 'loop';
    return join(this.dir, `${safe}.jsonl`);
  }

  private async load(loopId: string): Promise<StoredEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.fileFor(loopId), 'utf8');
    } catch {
      return [];
    }
    const out: StoredEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue; // skip a corrupt/partial line rather than failing the whole query
      }
      if (isJsonlRecord(parsed)) {
        out.push({ path: parsed.path, summary: parsed.summary, embedding: parsed.embedding });
      }
    }
    return out;
  }

  async query(loopId: string, q: string, k: number): Promise<MemoryHit[]> {
    const entries = await this.load(loopId);
    return rank(entries, q, k);
  }

  async append(loopId: string, entry: { path: string; summary: string }): Promise<void> {
    const file = this.fileFor(loopId);
    // Ensure the target directory exists (covers a not-yet-created base dir).
    await mkdir(dirname(file), { recursive: true });
    const record: JsonlRecord = {
      path: entry.path,
      summary: entry.summary,
      embedding: embed(entry.summary),
    };
    // Append one JSONL line; flag 'a' creates the file if it does not exist.
    await writeFile(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
  }
}
