/**
 * The cockpit's LOCAL persistence — a single-file SQLite database (node:sqlite, zero
 * native deps) that is the real source of truth for loops, their last-run state, and the
 * event history. It replaces the Phase-1 fixtures: nothing here is mock.
 *
 * SINGLE WRITER: only the Next server process touches this file. The engine runs as a
 * spawned subprocess that streams events over stdout; the run route ingests those events
 * and persists them here (and folds terminal status/health/cost back onto the loop row),
 * so a loop's state survives a server restart. Git artifacts + JSONL memory continue to
 * live on disk under .volumes/ as before.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DeptEvent } from '@departments/events';
import type { Loop, LoopLevel, LoopStatus, Phase } from '@departments/shared';

const DB_PATH = resolve(process.cwd(), '..', '..', '.volumes', 'departments.db');

// Persist the handle across Next dev hot-reloads (module re-evaluation) so we don't open
// a new connection every request.
const g = globalThis as unknown as { __departmentsDb?: DatabaseSync };

function getDb(): DatabaseSync {
  if (g.__departmentsDb) return g.__departmentsDb;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS loops (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      parent_loop_id TEXT,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      level INTEGER NOT NULL,
      mission TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      health INTEGER NOT NULL DEFAULT 100,
      phase TEXT,
      cycle_count INTEGER NOT NULL DEFAULT 0,
      cadence TEXT NOT NULL DEFAULT 'manual',
      budget_cap_usd REAL NOT NULL DEFAULT 100,
      spent_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      loop_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      id TEXT NOT NULL,
      run_id TEXT,
      kind TEXT NOT NULL,
      ts TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (loop_id, seq)
    );
  `);
  g.__departmentsDb = db;
  return db;
}

// ── Row ↔ Loop mapping ────────────────────────────────────────────────────────

interface LoopRow {
  id: string;
  org_id: string;
  parent_loop_id: string | null;
  name: string;
  display_name: string;
  level: number;
  mission: string;
  status: string;
  health: number;
  phase: string | null;
  cycle_count: number;
  cadence: string;
  budget_cap_usd: number;
  spent_usd: number;
  created_at: string;
  updated_at: string;
}

function rowToLoop(r: LoopRow): Loop {
  return {
    id: r.id,
    orgId: r.org_id,
    parentLoopId: r.parent_loop_id,
    name: r.name,
    displayName: r.display_name,
    level: r.level as LoopLevel,
    mission: r.mission,
    status: r.status as LoopStatus,
    health: r.health,
    phase: (r.phase as Phase | null) ?? null,
    cycleCount: r.cycle_count,
    cadence: r.cadence,
    cmaAgentId: null,
    memoryStoreId: null,
    repoUrl: null,
    budgetCapUsd: r.budget_cap_usd,
    spentUsd: r.spent_usd,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Loop CRUD ─────────────────────────────────────────────────────────────────

export function listLoops(orgId: string): Loop[] {
  const rows = getDb()
    .prepare('SELECT * FROM loops WHERE org_id = ? ORDER BY level ASC, created_at ASC')
    .all(orgId) as unknown as LoopRow[];
  return rows.map(rowToLoop);
}

export function getLoopRow(id: string): Loop | null {
  const row = getDb().prepare('SELECT * FROM loops WHERE id = ?').get(id) as unknown as LoopRow | undefined;
  return row ? rowToLoop(row) : null;
}

export interface CreateLoopInput {
  id: string;
  orgId: string;
  name: string;
  displayName: string;
  mission: string;
  level?: LoopLevel;
  parentLoopId?: string | null;
  cadence?: string;
  budgetCapUsd?: number;
  now: string;
}

export function createLoop(input: CreateLoopInput): Loop {
  getDb()
    .prepare(
      `INSERT INTO loops (id, org_id, parent_loop_id, name, display_name, level, mission, status, health,
        phase, cycle_count, cadence, budget_cap_usd, spent_usd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', 100, NULL, 0, ?, ?, 0, ?, ?)`,
    )
    .run(
      input.id,
      input.orgId,
      input.parentLoopId ?? null,
      input.name,
      input.displayName,
      input.level ?? 3,
      input.mission,
      input.cadence ?? 'manual',
      input.budgetCapUsd ?? 100,
      input.now,
      input.now,
    );
  return getLoopRow(input.id)!;
}

export function deleteLoop(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM events WHERE loop_id = ?').run(id);
  db.prepare('DELETE FROM loops WHERE id = ?').run(id);
}

/** Patch the durable config fields (cadence, budget, mission, displayName). */
export function patchLoop(id: string, patch: Partial<Pick<Loop, 'cadence' | 'budgetCapUsd' | 'mission' | 'displayName'>>, now: string): Loop | null {
  const existing = getLoopRow(id);
  if (!existing) return null;
  getDb()
    .prepare('UPDATE loops SET cadence = ?, budget_cap_usd = ?, mission = ?, display_name = ?, updated_at = ? WHERE id = ?')
    .run(
      patch.cadence ?? existing.cadence,
      patch.budgetCapUsd ?? existing.budgetCapUsd,
      patch.mission ?? existing.mission,
      patch.displayName ?? existing.displayName,
      now,
      id,
    );
  return getLoopRow(id);
}

// ── Event persistence + loop-state folding ───────────────────────────────────

/**
 * Persist one engine event and fold terminal signals onto the loop row so the loop list
 * reflects real last-run state after a restart: status (running/idle/paused), phase, the
 * canonical health metric, cycle count, and accumulated spend.
 */
export function recordEvent(e: DeptEvent): void {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO events (loop_id, seq, id, run_id, kind, ts, payload) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    e.loopId,
    e.seq,
    e.id,
    e.runId ?? null,
    e.kind,
    e.ts,
    JSON.stringify(e.payload),
  );

  if (!getLoopRow(e.loopId)) return; // events for an unknown loop just log

  if (e.kind === 'status' && e.payload.scope === 'loop') {
    const sets: string[] = ['updated_at = ?'];
    const vals: (string | number | null)[] = [e.ts];
    if (e.payload.loopStatus) {
      sets.push('status = ?');
      vals.push(e.payload.loopStatus);
      // A completed cycle returns to idle — bump the cycle counter once per completion.
      if (e.payload.loopStatus === 'idle') sets.push('cycle_count = cycle_count + 1');
    }
    if (e.payload.phase !== undefined) {
      sets.push('phase = ?');
      vals.push(e.payload.phase ?? null);
    }
    vals.push(e.loopId);
    db.prepare(`UPDATE loops SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  } else if (e.kind === 'metric' && e.payload.key === 'health') {
    db.prepare('UPDATE loops SET health = ?, updated_at = ? WHERE id = ?').run(Math.round(e.payload.value), e.ts, e.loopId);
  } else if (e.kind === 'log' && e.payload.source === 'engine') {
    // The engine has no cost EVENT in the frozen protocol — the per-cycle spend is in its
    // completion log ("…complete · health X% · … · $0.0730 · …"). Fold it onto spend.
    const m = /complete\b.*?\$([\d.]+)/.exec(e.payload.message);
    if (m) db.prepare('UPDATE loops SET spent_usd = spent_usd + ?, updated_at = ? WHERE id = ?').run(Number(m[1]), e.ts, e.loopId);
  }
}

/** Add to a loop's accumulated spend (the run route reports per-cycle cost). */
export function addSpend(loopId: string, costUsd: number, now: string): void {
  if (!getLoopRow(loopId)) return;
  getDb().prepare('UPDATE loops SET spent_usd = spent_usd + ?, updated_at = ? WHERE id = ?').run(costUsd, now, loopId);
}

/** Replay persisted events after a cursor (history that survives restart). */
export function listEvents(loopId: string, afterSeq = -1): DeptEvent[] {
  const rows = getDb()
    .prepare('SELECT loop_id, seq, id, run_id, kind, ts, payload FROM events WHERE loop_id = ? AND seq > ? ORDER BY seq ASC')
    .all(loopId, afterSeq) as unknown as Array<{ loop_id: string; seq: number; id: string; run_id: string | null; kind: string; ts: string; payload: string }>;
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    loopId: r.loop_id,
    runId: r.run_id ?? undefined,
    ts: r.ts,
    kind: r.kind,
    payload: JSON.parse(r.payload),
  })) as DeptEvent[];
}
