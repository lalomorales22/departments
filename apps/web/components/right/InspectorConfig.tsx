'use client';

import { RUBRIC_CATEGORIES, RUBRIC_CATEGORY_LABELS } from '@departments/shared';
import { getAgents, getLoop } from '@/lib/fixtures';
import { accentVar, rubricAccent } from '@/lib/status-theme';
import { cn } from '@/lib/cn';
import { SectionLabel } from '@/components/atoms';
import { useCockpit } from '@/lib/store';

/** Default gate pass threshold (presentational; the engine owns the real value). */
const GATE_THRESHOLD = 80;

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
          setLoopCadence(loopId, next);
          void fetch(`/api/loops/${encodeURIComponent(loopId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ cadence: next }),
          }).catch(() => {
            /* optimistic — the durable write is the engine/DB path */
          });
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
  const loop = getLoop(loopId);
  const agents = getAgents(loopId);

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

      {/* GATE THRESHOLDS */}
      <Block
        label="Gate Thresholds"
        right={<span className="tabular text-2xs text-faint">DEFAULT {GATE_THRESHOLD}%</span>}
      >
        <ul className="flex flex-col gap-3">
          {RUBRIC_CATEGORIES.map((cat) => {
            const accent = rubricAccent[cat];
            const color = accentVar(accent);
            return (
              <li key={cat}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">{RUBRIC_CATEGORY_LABELS[cat]}</span>
                  <span className="tabular text-2xs" style={{ color }}>
                    {GATE_THRESHOLD}%
                  </span>
                </div>
                {/* visually-disabled slider: filled track + knob at threshold */}
                <div
                  className="relative h-1 w-full cursor-not-allowed rounded-full bg-bg-deep opacity-60"
                  role="slider"
                  aria-valuenow={GATE_THRESHOLD}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${RUBRIC_CATEGORY_LABELS[cat]} threshold (read-only)`}
                  aria-disabled
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${GATE_THRESHOLD}%`, backgroundColor: color }}
                    aria-hidden
                  />
                  <div
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-hairline-strong bg-surface-3"
                    style={{ left: `${GATE_THRESHOLD}%` }}
                    aria-hidden
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Block>
    </div>
  );
}
