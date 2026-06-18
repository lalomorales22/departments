/**
 * Alerting — the cross-cutting alert contract + pure detectors.
 *
 * Phase 5 wires real alerts for the operational hazards a perpetually-running org
 * accrues: budget breaches, no-progress pauses, refusal storms (Fable/refusal-safe
 * path), realtime stream degradation, and RLS anomalies. The TYPES + pure detectors
 * live in `@departments/shared` so every layer speaks one alert vocabulary — the engine
 * raises them through an {@link AlertSink}, the gateway/sink runs the stream + refusal
 * detectors, and the cockpit renders them. No node-only deps; deterministic.
 */
import type { AccentKey } from './pipeline';

/** The hazards we alert on (README → Infra: alerting). */
export const ALERT_KINDS = [
  'budget_breach', // soft/hard cap reached
  'no_progress_pause', // the no-progress detector auto-paused a loop
  'refusal_storm', // a burst of model refusals (Fable refusal-safe path)
  'stream_degradation', // realtime spine: heartbeat/seq gaps, reconnect churn
  'rls_anomaly', // a cross-tenant access attempt / RLS policy miss
  'gate_failure', // a required gate fell below threshold (barrier)
  'cache_degradation', // prompt-cache reads collapsed mid-life (cost lever lost)
  'fable_approval_required', // the gated Fable-5 path was requested without approval
  'tool_denied', // an irreversible tool was denied at the always_ask gate
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export type AlertSeverity = 'info' | 'warning' | 'critical';

/** UI accent per severity (resolved to hex by the design system, never inlined). */
export const ALERT_SEVERITY_ACCENT: Readonly<Record<AlertSeverity, AccentKey>> = {
  info: 'blue',
  warning: 'amber',
  critical: 'red',
};

/** One alert. `ts` is stamped by the emitter (omitted here keeps detectors deterministic). */
export interface Alert {
  kind: AlertKind;
  severity: AlertSeverity;
  message: string;
  orgId?: string;
  loopId?: string;
  detail?: Record<string, unknown>;
  /** ISO-8601 — set by the bus/emitter at emit time. */
  ts?: string;
  /** Dedupe key (defaults to `kind:loopId`); same key within the window is suppressed. */
  key?: string;
}

/** Anything that consumes alerts (a bus, a logger, a websocket fan-out). */
export type AlertSink = (alert: Alert) => void;

/** Build an alert with a sane default dedupe key. */
export function makeAlert(
  kind: AlertKind,
  severity: AlertSeverity,
  message: string,
  scope: { orgId?: string; loopId?: string; detail?: Record<string, unknown> } = {},
): Alert {
  return {
    kind,
    severity,
    message,
    orgId: scope.orgId,
    loopId: scope.loopId,
    detail: scope.detail,
    key: `${kind}:${scope.loopId ?? scope.orgId ?? 'global'}`,
  };
}

/**
 * A small fan-out bus: routes each alert to every registered sink, keeps the most
 * recent N for a status feed, and DEDUPES by key within a cooldown window so a breach
 * that recurs every tick doesn't spam (the first fires; repeats inside the window are
 * dropped). `nowMs` is injected for deterministic tests.
 */
export class AlertBus {
  private readonly sinks: AlertSink[] = [];
  private readonly recent: Alert[] = [];
  private readonly lastFired = new Map<string, number>();

  constructor(
    private readonly opts: { cooldownMs?: number; keep?: number; nowMs?: () => number } = {},
  ) {}

  /** Register a sink (logger, WS fan-out, etc.). */
  subscribe(sink: AlertSink): void {
    this.sinks.push(sink);
  }

  /** Emit an alert (deduped within the cooldown). Returns true if it fired. */
  emit(alert: Alert): boolean {
    const now = (this.opts.nowMs ?? (() => 0))();
    const cooldown = this.opts.cooldownMs ?? 0;
    const key = alert.key ?? `${alert.kind}:${alert.loopId ?? alert.orgId ?? 'global'}`;
    const last = this.lastFired.get(key);
    if (last !== undefined && cooldown > 0 && now - last < cooldown) return false;
    this.lastFired.set(key, now);
    const keep = this.opts.keep ?? 100;
    this.recent.push(alert);
    if (this.recent.length > keep) this.recent.shift();
    for (const sink of this.sinks) sink(alert);
    return true;
  }

  /** The most recent alerts (oldest→newest), for a status feed. */
  feed(): readonly Alert[] {
    return this.recent;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure detectors (the rules behind refusal-storm + stream-degradation alerts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refusal-storm detector: counts refusals in a sliding time window and fires when the
 * count reaches a threshold (a burst means the Fable refusal-safe fallback isn't
 * holding, or a prompt is tripping the safety classifier). Time-injected for tests.
 */
export class RefusalStormDetector {
  private readonly times: number[] = [];

  constructor(private readonly threshold = 3, private readonly windowMs = 60_000) {}

  /** Record a refusal at `nowMs`; returns true when the window count hits the threshold. */
  record(nowMs: number): boolean {
    this.times.push(nowMs);
    const cutoff = nowMs - this.windowMs;
    while (this.times.length > 0 && this.times[0]! < cutoff) this.times.shift();
    return this.times.length >= this.threshold;
  }

  /** Current count within the window (after the last `record`). */
  get count(): number {
    return this.times.length;
  }
}

/**
 * Stream-health monitor for the realtime spine: flags degradation when the gap since
 * the last event exceeds a staleness bound (a missed heartbeat) or when a `seq` arrives
 * out of order / with a gap (lost frames). Drives the `stream_degradation` alert + the
 * StatusBar "RECONNECTING" state.
 */
export class StreamHealthMonitor {
  private lastSeq = -1;
  private lastEventMs = -1;

  constructor(private readonly stalenessMs = 30_000) {}

  /** Record an event's `seq` + arrival time; returns a degradation reason or null. */
  record(seq: number, nowMs: number): 'stale' | 'gap' | 'reorder' | null {
    let issue: 'stale' | 'gap' | 'reorder' | null = null;
    if (this.lastEventMs >= 0 && nowMs - this.lastEventMs > this.stalenessMs) issue = 'stale';
    else if (this.lastSeq >= 0 && seq < this.lastSeq) issue = 'reorder';
    else if (this.lastSeq >= 0 && seq > this.lastSeq + 1) issue = 'gap';
    this.lastSeq = Math.max(this.lastSeq, seq);
    this.lastEventMs = nowMs;
    return issue;
  }

  /** Whether the stream is stale as of `nowMs` (no event within the bound). */
  isStale(nowMs: number): boolean {
    return this.lastEventMs >= 0 && nowMs - this.lastEventMs > this.stalenessMs;
  }
}
