-- ════════════════════════════════════════════════════════════════════════════
-- 0002_pgvector.sql — semantic memory index (pgvector).
--
-- The memory table is created in 0001_init.sql WITHOUT the embedding column so
-- that the core schema is runnable on a vanilla Postgres (e.g. CI lint of the DDL)
-- before the extension is installed. This migration is the single place that
-- depends on pgvector.
--
-- ⚠️ Phase 1 (the demoable fixture UI) does NOT use semantic recall — the
-- inspector's CONTEXT/MEMORY panel binds to memory.summary + a UI-only relevance
-- float, never to a real cosine search. The embedding column and ivfflat index
-- below are provisioned now so Phase 2 (the live Loop Engine) can populate and
-- query them without a schema change. They are intentionally UNUSED in P1.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

-- text-embedding-3-small / Claude-tier embeddings are 1536-dim.
ALTER TABLE memory ADD COLUMN embedding vector(1536);

-- IVFFLAT approximate-NN index for cosine distance. lists=100 is a reasonable
-- starting point for the small P2 corpus; tune as the memory corpus grows.
--
-- NOTE: ivfflat requires the table to contain data to train its lists, and PG
-- requires a non-empty table for an accurate index build. On an empty/seed DB
-- this builds an empty index harmlessly. Re-run REINDEX after the first bulk load.
-- UNUSED in Phase 1 (see header).
CREATE INDEX memory_embedding_ivfflat_idx
  ON memory
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
