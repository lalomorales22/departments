'use client';

import { RUBRIC_CATEGORIES, RUBRIC_CATEGORY_LABELS, type RubricCategory } from '@departments/shared';
import { getGates } from '@/lib/fixtures';
import { useLoopById, useLoopRegistry } from '@/lib/loops-client';
import { useAgentRoster } from '@/lib/roster';
import { toast } from '@/lib/toast';
import { accentVar, rubricAccent } from '@/lib/status-theme';
import { cn } from '@/lib/cn';
import { SectionLabel } from '@/components/atoms';
import { useCockpit } from '@/lib/store';
import { useCan } from '@/lib/rbac';

/** Default gate pass threshold — mirrors the engine's DEFAULT_GATE_MIN_SCORE (60/100). */
const GATE_THRESHOLD = 60;

function healthAccentKey(h: number): 'green' | 'amber' | 'red' {
  return h >= 85 ? 'green' : h >= 60 ? 'amber' : 'red';
}

/**
 * The four gate-threshold sliders, now LIVE (Phase 5) with a Health-impact preview:
 * Health % = the rolling gate-pass rate, so raising a threshold above a gate's current
 * score flips it to failing and drops the previewed health. Editable only with the
 * `gate.threshold.edit` capability (Commander); others see the current thresholds
 * read-only. Edits are optimistic (store override + a best-effort PATCH).
 */
function GateThresholdEditor({ loopId }: { loopId: string }) {
  const overrides = useCockpit((s) => s.gateThresholds[loopId]);
  const setGateThreshold = useCockpit((s) => s.setGateThreshold);
  const canEdit = useCan('gate.threshold.edit');
  const gates = getGates(loopId);
  const scoreOf = (cat: RubricCategory) => gates.find((g) => g.category === cat)?.score ?? 0;
  const thresholdOf = (cat: RubricCategory) => overrides?.[cat] ?? GATE_THRESHOLD;

  // Preview: a gate clears when the grader passed it AND its score meets the threshold.
  // Match the engine's gatePassRate exactly — divide by GRADED categories only (a
  // category with no outcome yet doesn't count), and an ungraded loop is presumed
  // healthy (100%), so the cockpit preview never disagrees with the engine's Health %.
  const graded = RUBRIC_CATEGORIES.filter((cat) => gates.some((g) => g.category === cat));
  const cleared = graded.filter((cat) => {
    const g = gates.find((x) => x.category === cat);
    return g?.passed && g.score >= thresholdOf(cat);
  }).length;
  const previewHealth = graded.length === 0 ? 100 : Math.round((cleared / graded.length) * 100);

  return (
    <Block
      label="Gate Thresholds"
      right={
        <span className="tabular text-2xs" style={{ color: accentVar(healthAccentKey(previewHealth)) }}>
          HEALTH {previewHealth}%
        </span>
      }
    >
      <ul className="flex flex-col gap-3">
        {RUBRIC_CATEGORIES.map((cat) => {
          const color = accentVar(rubricAccent[cat]);
          const threshold = thresholdOf(cat);
          const score = scoreOf(cat);
          const passes = (gates.find((g) => g.category === cat)?.passed ?? false) && score >= threshold;
          return (
            <li key={cat}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs text-muted">{RUBRIC_CATEGORY_LABELS[cat]}</span>
                <span className="tabular text-2xs">
                  <span style={{ color: accentVar(passes ? 'green' : 'red') }}>{score}</span>
                  <span className="text-faint"> / </span>
                  <span style={{ color }}>{threshold}%</span>
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={threshold}
                disabled={!canEdit}
                aria-label={`${RUBRIC_CATEGORY_LABELS[cat]} pass threshold`}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setGateThreshold(loopId, cat, next);
                  void fetch(`/api/loops/${encodeURIComponent(loopId)}/gates`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ category: cat, threshold: next }),
                  }).catch(() => {
                    /* optimistic — durable write is the engine/DB path */
                  });
                }}
                className={cn('h-1 w-full cursor-pointer accent-current disabled:cursor-not-allowed disabled:opacity-60')}
                style={{ color }}
              />
            </li>
          );
        })}
      </ul>
      {!canEdit && (
        <p className="mt-2 text-2xs text-faint">Threshold editing requires the Commander role.</p>
      )}
    </Block>
  );
}

/** Cadence options the schedule editor offers (mirrors the engine's cadence floors). */
const CADENCE_OPTIONS = ['continuous', 'hourly', 'daily', 'nightly', 'weekly', 'manual', 'on-demand'];

/** An inline editable schedule control — optimistic store edit + a PATCH to the loop. */
function CadenceEditor({ loopId, fallback }: { loopId: string; fallback: string }) {
  const override = useCockpit((s) => s.loopCadence[loopId]);
  const setLoopCadence = useCockpit((s) => s.setLoopCadence);
  const value = override ?? fallback;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline/60 py-1.5">
      <span className="text-xs text-muted">Schedule</span>
      <select
        value={value}
        aria-label="Loop schedule / cadence"
        onChange={(e) => {
          const next = e.target.value;
          setLoopCadence(loopId, next); // optimistic
          void fetch(`/api/loops/${encodeURIComponent(loopId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ cadence: next }),
          })
            .then((res) => {
              if (res.ok) {
                toast.success(`Schedule set to ${next.toUpperCase()}.`);
                void useLoopRegistry.getState().hydrate(); // reflect the durable value
              } else {
                toast.error(`Couldn't save schedule (${res.status}).`);
              }
            })
            .catch(() => toast.error('Couldn’t save schedule — is the server reachable?'));
        }}
        className="tabular rounded-sm border border-hairline bg-bg-deep px-1.5 py-0.5 text-xs uppercase text-text focus-ring"
      >
        {CADENCE_OPTIONS.map((c) => (
          <option key={c} value={c}>
            {c.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Format a USD amount with thousands separators (machine-emitted → mono). */
function usd(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** A hairline-separated read-only section block. */
function Block({
  label,
  right,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-hairline px-3 py-3">
      <SectionLabel right={right}>{label}</SectionLabel>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/** A label/value row for the cadence + budget summary. */
function ConfigRow({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline/60 py-1.5 last:border-0">
      <span className="text-xs text-muted">{k}</span>
      <span
        className={cn('tabular text-xs', !accent && 'text-text')}
        style={accent ? { color: accent } : undefined}
      >
        {v}
      </span>
    </div>
  );
}

export function InspectorConfig({ loopId }: { loopId: string }) {
  const loop = useLoopById(loopId);
  const agents = useAgentRoster(loopId);

  const cap = loop?.budgetCapUsd ?? 0;
  const softCap = cap * 0.8;
  const spent = loop?.spentUsd ?? 0;
  const spentPct = cap > 0 ? Math.min(1, spent / cap) : 0;
  const softPct = cap > 0 ? Math.min(1, softCap / cap) : 0;
  const overSoft = spent > softCap;
  const ledgerAccent = overSoft ? 'amber' : 'green';

  return (
    <div className="animate-fade-in">
      {/* CADENCE */}
      <Block label="Cadence">
        <CadenceEditor loopId={loopId} fallback={loop?.cadence ?? 'manual'} />
        <ConfigRow k="Cycle Count" v={String(loop?.cycleCount ?? 0)} />
        <ConfigRow k="Status" v={(loop?.status ?? 'idle').toUpperCase()} />
      </Block>

      {/* BUDGET */}
      <Block
        label="Budget"
        right={
          <span className="tabular text-2xs" style={{ color: accentVar(ledgerAccent) }}>
            {(spentPct * 100).toFixed(0)}%
          </span>
        }
      >
        <ConfigRow k="Hard Cap" v={usd(cap)} />
        <ConfigRow k="Soft Cap (80%)" v={usd(softCap)} />
        <ConfigRow k="Spent" v={`$${spent.toFixed(2)}`} accent={accentVar(ledgerAccent)} />

        {/* ledger bar: spend fill + soft-cap tick on a hairline track */}
        <div className="relative mt-2.5 h-1.5 w-full overflow-hidden rounded-full border border-hairline bg-bg-deep">
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${spentPct * 100}%`,
              backgroundColor: accentVar(ledgerAccent),
            }}
            aria-hidden
          />
          <div
            className="absolute inset-y-0 w-px bg-faint"
            style={{ left: `${softPct * 100}%` }}
            aria-hidden
          />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="tabular text-2xs text-faint">$0</span>
          <span className="tabular text-2xs text-faint">soft {usd(softCap)}</span>
          <span className="tabular text-2xs text-faint">{usd(cap)}</span>
        </div>
      </Block>

      {/* MODEL TIERING */}
      <Block
        label="Model Tiering"
        right={<span className="tabular text-2xs text-faint">{agents.length}</span>}
      >
        {agents.length === 0 ? (
          <p className="text-2xs text-faint">No agents provisioned.</p>
        ) : (
          <div className="overflow-hidden rounded-sm border border-hairline">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-hairline bg-surface-2">
                  <th className="eyebrow px-2 py-1 font-normal">Agent</th>
                  <th className="eyebrow px-2 py-1 font-normal">Model</th>
                  <th className="eyebrow px-2 py-1 text-right font-normal">Effort</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-b border-hairline/60 last:border-0">
                    <td className="max-w-[7rem] truncate px-2 py-1 text-xs text-text">
                      {a.name}
                    </td>
                    <td className="tabular px-2 py-1 text-2xs text-muted">{a.modelId}</td>
                    <td className="tabular px-2 py-1 text-right text-2xs text-faint">
                      {a.effort ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>

      {/* GATE THRESHOLDS — live sliders + Health-impact preview (Phase 5) */}
      <GateThresholdEditor loopId={loopId} />
    </div>
  );
}
