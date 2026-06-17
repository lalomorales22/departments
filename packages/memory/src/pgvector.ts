/**
 * PgVectorMemoryStore — the production MemoryPort backed by Postgres + pgvector.
 *
 * It depends on two INJECTED interfaces so it can be unit-tested with fakes and
 * typecheck without a live database or any SDK:
 *
 *   PgClient  — the minimal query surface we use (matches `pg` / `postgres.js`
 *               / a pooled wrapper). We never import a driver here.
 *   Embedder  — turns text into a real embedding vector. The local stand-in in
 *               `embed.ts` is NOT used here; a real provider embedder is wired
 *               at the composition root.
 *
 * Real wiring (a live `pg` Pool + a real embedding model) is GATED behind
 * `DATABASE_URL` (and the embedder's own credentials). When that env var is
 * absent the integration test is skipped; the SQL-builder logic below is still
 * unit-tested against a fake `PgClient` that captures the query string.
 *
 * Schema assumed (created by `packages/db` migrations, pgvector enabled):
 *
 *   CREATE TABLE memory (
 *     loop_id    text   NOT NULL,
 *     path       text   NOT NULL,
 *     summary    text   NOT NULL,
 *     embedding  vector NOT NULL,
 *     PRIMARY KEY (loop_id, path)
 *   );
 *
 * The vector distance operator `<->` (L2) is used for ORDER BY; `1 - distance`
 * approximates a relevance score for normalized embeddings, clamped to 0..1.
 */
import type { MemoryHit, MemoryPort } from './store';

/** The minimal Postgres client surface this store relies on. */
export interface PgClient {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
}

/** A real embedding model. Returns a fixed-dimension numeric vector for `text`. */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}

/** Configuration knobs (table name is overridable for tests / multi-schema). */
export interface PgVectorOptions {
  /** Defaults to "memory". */
  table?: string;
}

/** A row as returned by the recall query. `distance` is the pgvector `<->` value. */
interface MemoryRow {
  path: string;
  summary: string;
  distance: number;
}

function isMemoryRow(v: unknown): v is MemoryRow {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r['path'] === 'string' && typeof r['summary'] === 'string' && typeof r['distance'] === 'number';
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Format a JS number[] as a pgvector literal, e.g. `[0.1,0.2,0.3]`. pgvector
 * accepts this text form for both inserts and the distance operand.
 */
export function toVectorLiteral(vec: readonly number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Build the UPSERT statement. Exposed for unit testing the SQL shape. The vector
 * is passed as a parameter (cast to `::vector`) so values are never interpolated
 * into the SQL string.
 */
export function buildUpsertSql(table: string): string {
  return (
    `INSERT INTO ${table} (loop_id, path, summary, embedding) ` +
    `VALUES ($1, $2, $3, $4::vector) ` +
    `ON CONFLICT (loop_id, path) DO UPDATE SET ` +
    `summary = EXCLUDED.summary, embedding = EXCLUDED.embedding`
  );
}

/**
 * Build the recall statement: nearest neighbours for one loop ordered by the
 * pgvector distance operator `<->`, limited to k. Exposed for unit testing the
 * SQL shape (the test asserts it ORDER BYs the vector op and LIMITs k).
 */
export function buildQuerySql(table: string): string {
  return (
    `SELECT path, summary, (embedding <-> $1::vector) AS distance ` +
    `FROM ${table} ` +
    `WHERE loop_id = $2 ` +
    `ORDER BY embedding <-> $1::vector ASC ` +
    `LIMIT $3`
  );
}

export class PgVectorMemoryStore implements MemoryPort {
  private readonly table: string;

  constructor(
    private readonly client: PgClient,
    private readonly embedder: Embedder,
    options: PgVectorOptions = {},
  ) {
    // Guard the table name against injection (identifiers can't be parameters).
    const requested = options.table ?? 'memory';
    if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/u.test(requested)) {
      throw new Error(`invalid table name: ${requested}`);
    }
    this.table = requested;
  }

  async append(loopId: string, entry: { path: string; summary: string }): Promise<void> {
    const vec = await this.embedder.embed(entry.summary);
    await this.client.query(buildUpsertSql(this.table), [
      loopId,
      entry.path,
      entry.summary,
      toVectorLiteral(vec),
    ]);
  }

  async query(loopId: string, q: string, k: number): Promise<MemoryHit[]> {
    if (k <= 0) return [];
    const qv = await this.embedder.embed(q);
    const { rows } = await this.client.query(buildQuerySql(this.table), [
      toVectorLiteral(qv),
      loopId,
      k,
    ]);
    const hits: MemoryHit[] = [];
    for (const row of rows) {
      if (!isMemoryRow(row)) continue;
      // For (near-)unit-norm embeddings L2 distance d relates to cosine sim as
      // sim ≈ 1 - d²/2; we use the simpler, monotonic 1 - d and clamp — exact
      // ordering is already guaranteed by ORDER BY in SQL.
      hits.push({ path: row.path, summary: row.summary, relevance: clamp01(1 - row.distance) });
    }
    return hits;
  }
}
