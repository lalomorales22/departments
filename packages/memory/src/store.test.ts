import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMBED_DIM, cosineSim, embed } from './embed';
import { FileMemoryStore, InMemoryMemoryStore } from './store';
import {
  type Embedder,
  type PgClient,
  PgVectorMemoryStore,
  buildQuerySql,
  buildUpsertSql,
  toVectorLiteral,
} from './pgvector';

describe('embed / cosineSim', () => {
  it('is deterministic and fixed-dimension', () => {
    const a = embed('the marketing loop improves bounce rate');
    const b = embed('the marketing loop improves bounce rate');
    expect(a).toHaveLength(EMBED_DIM);
    expect(a).toEqual(b);
  });

  it('is order-insensitive (bag of words)', () => {
    expect(embed('bounce rate dropped')).toEqual(embed('dropped rate bounce'));
  });

  it('scores overlapping text higher than disjoint text', () => {
    const q = embed('seo keyword research strategy');
    const near = embed('keyword research drives seo strategy gains');
    const far = embed('the cafeteria served warm soup today');
    expect(cosineSim(q, near)).toBeGreaterThan(cosineSim(q, far));
  });

  it('identical text has similarity ~1; empty text yields 0', () => {
    const v = embed('alignment risk gate failed twice');
    expect(cosineSim(v, v)).toBeCloseTo(1, 10);
    expect(cosineSim(embed(''), v)).toBe(0);
  });
});

describe('InMemoryMemoryStore', () => {
  it('returns the most relevant insight first and respects k', async () => {
    const store = new InMemoryMemoryStore();
    await store.append('loop-1', { path: 'mem/a', summary: 'caching cut token cost dramatically on tick two' });
    await store.append('loop-1', { path: 'mem/b', summary: 'the graphic designer produced new banner assets' });
    await store.append('loop-1', { path: 'mem/c', summary: 'prompt caching is the number one cost lever for token spend' });

    const hits = await store.query('loop-1', 'how do we reduce token cost with caching', 2);
    expect(hits).toHaveLength(2);
    // The two caching-related insights should rank above the unrelated designer note.
    expect([hits[0]?.path, hits[1]?.path].sort()).toEqual(['mem/a', 'mem/c']);
    // Relevance is the (clamped) similarity, descending.
    expect(hits[0]?.relevance).toBeGreaterThanOrEqual(hits[1]?.relevance ?? 0);
    expect(hits[0]?.relevance).toBeGreaterThan(0);
    expect(hits[0]?.relevance).toBeLessThanOrEqual(1);
  });

  it('partitions entries by loopId', async () => {
    const store = new InMemoryMemoryStore();
    await store.append('loop-a', { path: 'a/1', summary: 'budget ledger soft cap triggered a downgrade' });
    await store.append('loop-b', { path: 'b/1', summary: 'budget ledger soft cap triggered a downgrade' });
    const a = await store.query('loop-a', 'budget cap downgrade', 10);
    const b = await store.query('loop-b', 'budget cap downgrade', 10);
    expect(a.map((h) => h.path)).toEqual(['a/1']);
    expect(b.map((h) => h.path)).toEqual(['b/1']);
  });

  it('k <= 0 returns no hits', async () => {
    const store = new InMemoryMemoryStore();
    await store.append('loop-1', { path: 'x', summary: 'anything' });
    expect(await store.query('loop-1', 'anything', 0)).toEqual([]);
  });
});

describe('FileMemoryStore', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dept-mem-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips across instances (persisted to JSONL)', async () => {
    const writer = new FileMemoryStore(dir);
    await writer.append('loop-x', { path: 'mem/plan', summary: 'plan reads handoff then queries memory first' });
    await writer.append('loop-x', { path: 'mem/grade', summary: 'independent grader failed the data validation gate' });

    // A brand-new instance pointed at the same dir must see the prior entries.
    const reader = new FileMemoryStore(dir);
    const hits = await reader.query('loop-x', 'who reads memory during planning', 5);
    expect(hits.map((h) => h.path)).toContain('mem/plan');
    // Most relevant should be the planning insight, not the grader note.
    expect(hits[0]?.path).toBe('mem/plan');
  });

  it('keeps loops in separate files', async () => {
    const store = new FileMemoryStore(dir);
    await store.append('loop-y', { path: 'y/1', summary: 'performance metric improved this cycle' });
    const x = await store.query('loop-x', 'performance metric', 5);
    const y = await store.query('loop-y', 'performance metric', 5);
    expect(x.map((h) => h.path)).not.toContain('y/1');
    expect(y.map((h) => h.path)).toContain('y/1');
  });
});

// ── PgVectorMemoryStore: SQL-builder logic with a query-capturing fake ─────────

class FakePgClient implements PgClient {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  private readonly rowsToReturn: unknown[];

  constructor(rows: unknown[] = []) {
    this.rowsToReturn = rows;
  }

  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    this.calls.push({ sql, params });
    return Promise.resolve({ rows: this.rowsToReturn });
  }
}

/** A trivial fake embedder — fixed small vector, no credentials, no network. */
const fakeEmbedder: Embedder = {
  embed: (text: string) => Promise.resolve(text.length === 0 ? [0, 0, 0] : [0.1, 0.2, 0.3]),
};

describe('PgVectorMemoryStore (unit, fake PgClient)', () => {
  it('buildQuerySql ORDER BYs the vector op and LIMITs k', () => {
    const sql = buildQuerySql('memory');
    expect(sql).toMatch(/ORDER BY\s+embedding\s+<->\s+\$1::vector/u);
    expect(sql).toMatch(/LIMIT\s+\$3/u);
    expect(sql).toMatch(/WHERE\s+loop_id\s*=\s*\$2/u);
  });

  it('buildUpsertSql inserts with an ON CONFLICT upsert and ::vector cast', () => {
    const sql = buildUpsertSql('memory');
    expect(sql).toMatch(/INSERT INTO memory/u);
    expect(sql).toMatch(/\$4::vector/u);
    expect(sql).toMatch(/ON CONFLICT \(loop_id, path\) DO UPDATE/u);
  });

  it('query passes the embedded vector literal, loopId, and k as params', async () => {
    const client = new FakePgClient([
      { path: 'mem/a', summary: 'closest', distance: 0.05 },
      { path: 'mem/b', summary: 'farther', distance: 0.4 },
    ]);
    const store = new PgVectorMemoryStore(client, fakeEmbedder);
    const hits = await store.query('loop-z', 'recall something', 7);

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call?.sql).toBe(buildQuerySql('memory'));
    expect(call?.params).toEqual([toVectorLiteral([0.1, 0.2, 0.3]), 'loop-z', 7]);

    // Relevance is derived from distance (1 - d, clamped) and preserves SQL order.
    expect(hits.map((h) => h.path)).toEqual(['mem/a', 'mem/b']);
    expect(hits[0]?.relevance).toBeCloseTo(0.95, 10);
    expect(hits[0]?.relevance).toBeGreaterThan(hits[1]?.relevance ?? 1);
    expect(hits[0]?.relevance).toBeLessThanOrEqual(1);
  });

  it('append upserts with [loopId, path, summary, vectorLiteral]', async () => {
    const client = new FakePgClient();
    const store = new PgVectorMemoryStore(client, fakeEmbedder);
    await store.append('loop-z', { path: 'mem/new', summary: 'a distilled insight' });

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call?.sql).toBe(buildUpsertSql('memory'));
    expect(call?.params).toEqual(['loop-z', 'mem/new', 'a distilled insight', toVectorLiteral([0.1, 0.2, 0.3])]);
  });

  it('honors a custom table name and rejects an unsafe one', async () => {
    const client = new FakePgClient();
    const store = new PgVectorMemoryStore(client, fakeEmbedder, { table: 'tenant.memory' });
    await store.query('loop-z', 'q', 3);
    expect(client.calls[0]?.sql).toBe(buildQuerySql('tenant.memory'));

    expect(() => new PgVectorMemoryStore(client, fakeEmbedder, { table: 'mem; DROP TABLE x' })).toThrow(
      /invalid table name/u,
    );
  });

  it('k <= 0 short-circuits without touching the client', async () => {
    const client = new FakePgClient();
    const store = new PgVectorMemoryStore(client, fakeEmbedder);
    expect(await store.query('loop-z', 'q', 0)).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });
});
