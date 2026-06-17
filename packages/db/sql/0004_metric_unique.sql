-- 0004_metric_unique.sql — Phase 3: idempotent "latest metric" upserts.
--
-- The realtime sink rolls the most recent value of each metric key into Postgres for
-- the HISTORY/sparkline reads. That requires a stable conflict target: one row per
-- (loop_id, key) holding the latest sample. Without it, `INSERT ... ON CONFLICT
-- (loop_id, key) DO UPDATE` has nothing to match and every tick would append a new row.
--
-- Safe to apply: seed + live data carry distinct keys per loop, so no existing rows
-- collide. Runs after RLS (0003) and before the seed (0100).

ALTER TABLE metric
  ADD CONSTRAINT metric_loop_key_uniq UNIQUE (loop_id, key);
