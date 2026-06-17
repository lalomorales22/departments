/**
 * Deterministic, dependency-free LOCAL embedding for ranking memory entries.
 *
 * This is a deliberate STAND-IN for a real embedding model. It hashes a
 * bag-of-words into a fixed-dimension vector so that two texts sharing
 * vocabulary land near each other under cosine similarity — good enough to
 * rank distilled insights by topical overlap with zero external dependencies
 * and fully reproducible test output.
 *
 * The real embedder (an Anthropic / provider model) is wired only in
 * `pgvector.ts` behind the injected `Embedder` interface and gated on
 * `DATABASE_URL` — never on the hot path of the in-memory / file stores.
 *
 * Properties relied on by the stores and tests:
 *  - Pure & deterministic: `embed(x)` always returns the same vector.
 *  - Fixed dimensionality: every vector has exactly `EMBED_DIM` components.
 *  - Order-insensitive: it is a bag-of-words, so word order does not matter.
 *  - L2-normalized: `cosineSim` therefore reduces to a dot product and is
 *    naturally bounded in [-1, 1] (and in [0, 1] for these non-negative,
 *    term-frequency vectors).
 */

/** Fixed embedding dimensionality. Small enough to be cheap, large enough to spread tokens. */
export const EMBED_DIM = 256;

/**
 * Split text into normalized word tokens. Lowercased; non-alphanumeric runs are
 * separators; empty tokens dropped. Deterministic for a given input.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length > 0);
}

/**
 * FNV-1a 32-bit hash — a fast, stable, dependency-free string hash. Used to map
 * a token to one of `EMBED_DIM` buckets. Stability across runs/processes is the
 * only requirement (we never need cryptographic strength).
 */
function hashToken(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    // h *= 16777619, kept in 32-bit space via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned, then fold into the vector dimension.
  return (h >>> 0) % EMBED_DIM;
}

/**
 * Embed text into a fixed-dimension, L2-normalized term-frequency vector.
 *
 * Empty / token-free input yields the zero vector (all components 0), which
 * `cosineSim` treats as zero similarity against anything.
 */
export function embed(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  for (const token of tokenize(text)) {
    const bucket = hashToken(token);
    // Guarded write: bucket is always in-range, but noUncheckedIndexedAccess
    // makes the read possibly-undefined, so coalesce.
    vec[bucket] = (vec[bucket] ?? 0) + 1;
  }
  // L2-normalize so cosine similarity is a plain dot product.
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i += 1) {
    vec[i] = (vec[i] ?? 0) / norm;
  }
  return vec;
}

/**
 * Cosine similarity of two equal-length vectors. Returns 0 if either vector is
 * the zero vector or the lengths differ (defensive — callers should pass
 * `embed()` output, which is always `EMBED_DIM` long).
 */
export function cosineSim(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
