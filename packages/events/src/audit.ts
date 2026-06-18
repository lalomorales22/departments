/**
 * Tamper-evident audit chain — an APPEND-ONLY hash chain computed OVER the event
 * stream, kept strictly as a SIDECAR.
 *
 * The `Event` protocol is frozen at {@link EVENT_PROTOCOL_VERSION} = 1: no new
 * top-level fields on `BaseEvent`. So the tamper-evidence layer never touches the wire
 * shape — it derives, for each event, an entry `{ seq, id, hash, prevHash }` where
 * `hash = sha256(prevHash + canonical(event))`. Any mutation of any event changes its
 * hash and therefore every subsequent hash, so a single altered/removed/reordered row
 * is detectable by re-deriving the chain and comparing. The DB enforces immutability
 * with triggers (`0006_audit.sql`); this is the in-process verifier the gateway/sink
 * and the RLS-audit CI gate share, and it requires no schema change to the protocol.
 *
 * Pure except for `node:crypto` (sha256); deterministic for the same event sequence.
 */
import { createHash } from 'node:crypto';
import type { DeptEvent } from './index';

/** The chain's genesis link — the `prevHash` of the first event. */
export const AUDIT_GENESIS = '0'.repeat(64);

/** One link in the hash chain (a sidecar record; never part of the event wire shape). */
export interface AuditEntry {
  /** The event's monotonic per-loop seq. */
  seq: number;
  /** The event's stable id (dedupe key). */
  id: string;
  /** sha256(prevHash + canonical(event)). */
  hash: string;
  /** The prior link's hash (AUDIT_GENESIS for the first). */
  prevHash: string;
}

/**
 * Deterministic JSON of an event: object keys sorted recursively so two structurally
 * equal events always serialize identically (a Map-ordered or reordered payload can't
 * change the hash). Arrays keep their order (order is meaningful).
 */
export function canonicalEvent(event: DeptEvent): string {
  return stableStringify(event);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const body = keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',');
  return `{${body}}`;
}

/** The chain hash for one event given the prior link's hash. */
export function hashEvent(event: DeptEvent, prevHash: string): string {
  return createHash('sha256').update(prevHash).update('\n').update(canonicalEvent(event)).digest('hex');
}

/** Re-derive the full chain for an ordered event sequence (genesis-rooted). */
export function buildChain(events: readonly DeptEvent[]): AuditEntry[] {
  const entries: AuditEntry[] = [];
  let prevHash = AUDIT_GENESIS;
  for (const event of events) {
    const hash = hashEvent(event, prevHash);
    entries.push({ seq: event.seq, id: event.id, hash, prevHash });
    prevHash = hash;
  }
  return entries;
}

/** The outcome of verifying a stored chain against a (possibly altered) event sequence. */
export interface ChainVerification {
  ok: boolean;
  /** First seq where the re-derived chain diverged from the stored entries, if any. */
  brokenAt?: number;
  /** Human-readable reason (mismatch / length / monotonicity). */
  reason?: string;
}

/**
 * Verify that `events` reproduce the stored `entries` exactly. Detects content
 * tampering (hash mismatch), insertion/deletion (length mismatch), and reordering
 * (prevHash mismatch). Also enforces strictly-increasing seq (no gaps allowed to be
 * silent — a missing link breaks monotonicity).
 */
export function verifyChain(events: readonly DeptEvent[], entries: readonly AuditEntry[]): ChainVerification {
  if (events.length !== entries.length) {
    return { ok: false, reason: `length mismatch: ${events.length} events vs ${entries.length} entries` };
  }
  let prevHash = AUDIT_GENESIS;
  let prevSeq = -Infinity;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const stored = entries[i]!;
    if (event.seq <= prevSeq) {
      return { ok: false, brokenAt: event.seq, reason: `seq not strictly increasing at index ${i}` };
    }
    const hash = hashEvent(event, prevHash);
    if (stored.prevHash !== prevHash || stored.hash !== hash || stored.seq !== event.seq || stored.id !== event.id) {
      return { ok: false, brokenAt: event.seq, reason: `chain diverged at seq ${event.seq}` };
    }
    prevHash = hash;
    prevSeq = event.seq;
  }
  return { ok: true };
}

/**
 * A stateful, append-only chain the sink/gateway feeds every event into as it is
 * recorded. Enforces strictly-increasing seq on append (the monotonicity invariant)
 * and exposes the running tip so a downstream store can persist `(seq, id, hash,
 * prevHash)` alongside the event without mutating the event itself.
 */
export class AuditChain {
  private tip = AUDIT_GENESIS;
  private lastSeq = -Infinity;
  private readonly log: AuditEntry[] = [];

  /** Append an event; returns its link. Throws if seq is not strictly increasing. */
  append(event: DeptEvent): AuditEntry {
    if (event.seq <= this.lastSeq) {
      throw new Error(`audit chain: non-monotonic seq ${event.seq} (last ${this.lastSeq}) for loop ${event.loopId}`);
    }
    const hash = hashEvent(event, this.tip);
    const entry: AuditEntry = { seq: event.seq, id: event.id, hash, prevHash: this.tip };
    this.tip = hash;
    this.lastSeq = event.seq;
    this.log.push(entry);
    return entry;
  }

  /** The current chain head (hash of the most recent event, or genesis if empty). */
  get head(): string {
    return this.tip;
  }

  /** The number of links appended. */
  get length(): number {
    return this.log.length;
  }

  /** A read-only view of every link, in append order. */
  entries(): readonly AuditEntry[] {
    return this.log;
  }
}
