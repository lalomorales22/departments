/**
 * @departments/memory — MemoryPort implementations.
 *
 * - `embed` / `cosineSim`: a deterministic, dependency-free local embedding used
 *   for ranking in the in-memory and file stores (a stand-in for a real model).
 * - `InMemoryMemoryStore` / `FileMemoryStore`: process-local and JSONL-persisted
 *   stores satisfying the engine's `MemoryPort` shape.
 * - `PgVectorMemoryStore`: the production store against an injected `PgClient` +
 *   `Embedder`; real pgvector + a real embedder are gated behind `DATABASE_URL`.
 */
export { EMBED_DIM, embed, cosineSim } from './embed';
export type { MemoryHit, MemoryPort } from './store';
export { InMemoryMemoryStore, FileMemoryStore } from './store';
export type { PgClient, Embedder, PgVectorOptions } from './pgvector';
export {
  PgVectorMemoryStore,
  buildUpsertSql,
  buildQuerySql,
  toVectorLiteral,
} from './pgvector';
