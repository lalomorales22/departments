'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RUBRIC_CATEGORIES,
  RUBRIC_CATEGORY_LABELS,
  ROLES_BY_SENIORITY,
  USER_ROLE_LABELS,
  canAssignRole,
  type RubricCategory,
  type UserRole,
} from '@departments/shared';
import { SectionLabel } from '@/components/atoms';
import { useLoopTree } from '@/lib/loops-client';
import { LOCAL_ORG } from '@/lib/workspace';
import { aggregate, flattenRollup, rollupForest } from '@/lib/tree';
import { accentVar, rubricAccent } from '@/lib/status-theme';
import { useCockpit, SETTINGS_TABS, ORCHESTRATOR_ROLES, type SettingsTab } from '@/lib/store';
import { useCan, useUserRole } from '@/lib/rbac';
import { cn } from '@/lib/cn';

/** Demo org roster (prod hydrates from GET /api/org/members). */
const MEMBERS: { id: string; name: string; email: string; role: UserRole }[] = [
  { id: 'u-owner', name: 'Alex Rivera', email: 'alex@southbay.example', role: 'owner' },
  { id: 'u-cmdr', name: 'Commander', email: 'southbayitsolutions619@gmail.com', role: 'commander' },
  { id: 'u-op', name: 'Sam Operator', email: 'sam@southbay.example', role: 'operator' },
  { id: 'u-view', name: 'Jordan Viewer', email: 'jordan@southbay.example', role: 'viewer' },
];

const DEFAULT_GATE_THRESHOLD = 60;

function usd(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
}
function healthAccentKey(h: number): 'green' | 'amber' | 'red' {
  return h >= 85 ? 'green' : h >= 60 ? 'amber' : 'red';
}

const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  PROVIDER: 'AI Provider',
  DEFAULTS: 'Defaults',
  GATES: 'Gate Thresholds',
  MEMBERS: 'Members & Roles',
  BILLING: 'Billing & Limits',
  INTEGRATIONS: 'Integrations',
};

/**
 * The SETTINGS tab (Phase 5). Five role-gated panes: workspace Defaults, org-level Gate
 * Thresholds, Members & Roles, the per-org Billing/budget dashboard, and Integrations.
 * Owner/Commander get the editing surfaces; Operator/Viewer see them read-only — the
 * gateway enforces the same RBAC server-side.
 */
export function SettingsView() {
  const tab = useCockpit((s) => s.settingsTab);
  const setTab = useCockpit((s) => s.setSettingsTab);

  return (
    <div className="flex flex-col gap-3 animate-fade-in">
      <nav className="flex flex-wrap gap-1.5" aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={t === tab}
            className={cn(
              'rounded-sm border px-2.5 py-1 text-2xs uppercase tracking-wider transition-colors focus-ring',
              t === tab
                ? 'border-accent-cyan/45 bg-accent-cyan/10 text-accent-cyan'
                : 'border-hairline bg-surface-2 text-muted hover:text-text',
            )}
          >
            {SETTINGS_TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      {tab === 'PROVIDER' && <ProviderPane />}
      {tab === 'DEFAULTS' && <DefaultsPane />}
      {tab === 'GATES' && <GatesPane />}
      {tab === 'MEMBERS' && <MembersPane />}
      {tab === 'BILLING' && <BillingPane />}
      {tab === 'INTEGRATIONS' && <IntegrationsPane />}
    </div>
  );
}

function ReadOnlyHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-2xs text-faint">{children}</p>;
}

// ── AI Provider (Ollama local · Claude) ──────────────────────────────────────────

interface OllamaModel {
  name: string;
  sizeGb: number | null;
  paramSize: string | null;
  contextLength: number | null;
  capabilities: string[];
}
interface ModelsResponse {
  reachable: boolean;
  baseUrl: string;
  models: OllamaModel[];
  error?: string;
}

const CLAUDE_MODELS: { id: string; label: string }[] = [
  { id: '', label: 'Per-role tiering (Opus · Sonnet) — recommended' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — judgment' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — executor' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — worker' },
];

/** Which cycle phase each orchestrator role drives (tooltip on the per-role rows). */
const ROLE_PHASE: Record<string, string> = {
  planner: 'PLAN phase',
  executor: 'EXECUTE phase',
  reviewer: 'EVALUATE / IMPROVE phase',
  docs: 'MEMORY phase',
};

/** The shared <option> list of installed Ollama models (size + tool capability). */
function OllamaOptions({ models }: { models: OllamaModel[] }) {
  return (
    <>
      {models.map((m) => (
        <option key={m.name} value={m.name}>
          {m.name}
          {m.sizeGb ? ` · ${m.sizeGb}GB` : ''}
          {m.capabilities.includes('tools') ? ' · tools' : ''}
        </option>
      ))}
    </>
  );
}

function ProviderPane() {
  const canEdit = useCan('loop.config.edit');
  const cfg = useCockpit((s) => s.providerConfig);
  const setCfg = useCockpit((s) => s.setProviderConfig);

  const [tags, setTags] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (baseUrl: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ollama/models?baseUrl=${encodeURIComponent(baseUrl)}`, { cache: 'no-store' });
      setTags((await res.json()) as ModelsResponse);
    } catch {
      setTags({ reachable: false, baseUrl, models: [], error: 'request failed' });
    } finally {
      setLoading(false);
    }
  }, []);

  // Load installed models when the Ollama provider is active.
  useEffect(() => {
    if (cfg.provider === 'ollama') void refresh(cfg.ollamaBaseUrl);
  }, [cfg.provider, cfg.ollamaBaseUrl, refresh]);

  const reachable = tags?.reachable ?? false;
  const models = tags?.models ?? [];
  const active = cfg.provider === 'ollama' ? cfg.ollamaModel || '— pick a model —' : cfg.claudeModel || 'tiered (Opus · Sonnet)';

  return (
    <div className="flex flex-col gap-3">
      {/* Provider selector */}
      <div className="panel p-3">
        <SectionLabel right={<span className="tabular text-2xs text-faint">{cfg.provider === 'ollama' ? 'LOCAL · $0' : 'CLOUD · METERED'}</span>}>
          AI Provider — drives every loop&apos;s cognition
        </SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ProviderCard
            active={cfg.provider === 'ollama'}
            disabled={!canEdit}
            onClick={() => setCfg({ provider: 'ollama' })}
            title="Ollama (local)"
            sub="Runs on this machine. No key, no cost."
            accent="green"
          />
          <ProviderCard
            active={cfg.provider === 'claude'}
            disabled={!canEdit}
            onClick={() => setCfg({ provider: 'claude' })}
            title="Claude (API)"
            sub="Anthropic Messages API. Needs a key."
            accent="purple"
          />
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted">
          <span className="text-faint">Active:</span>
          <span className="tabular rounded-sm border border-accent-cyan/40 bg-accent-cyan/10 px-1.5 py-0.5 text-accent-cyan">
            {cfg.provider} · {active}
          </span>
        </p>
      </div>

      {/* Ollama configuration */}
      {cfg.provider === 'ollama' && (
        <div className="panel p-3">
          <SectionLabel
            right={
              <span
                className="tabular text-2xs uppercase"
                style={{ color: accentVar(reachable ? 'green' : 'red') }}
              >
                {loading ? 'CHECKING…' : reachable ? `● REACHABLE · ${models.length}` : '● NOT REACHABLE'}
              </span>
            }
          >
            Ollama Daemon
          </SectionLabel>

          <label className="mt-3 block">
            <span className="eyebrow">Base URL</span>
            <input
              type="text"
              value={cfg.ollamaBaseUrl}
              disabled={!canEdit}
              spellCheck={false}
              onChange={(e) => setCfg({ ollamaBaseUrl: e.target.value })}
              className="tabular mt-1 w-full rounded-sm border border-hairline bg-bg-deep px-2 py-1 text-xs text-text focus-ring disabled:opacity-60"
            />
          </label>

          <label className="mt-3 block">
            <span className="eyebrow">Default Model (all roles)</span>
            <select
              value={cfg.ollamaModel}
              disabled={!canEdit || !reachable || models.length === 0}
              onChange={(e) => setCfg({ ollamaModel: e.target.value })}
              className="tabular mt-1 w-full rounded-sm border border-hairline bg-bg-deep px-2 py-1 text-xs text-text focus-ring disabled:opacity-60"
            >
              <option value="">{reachable ? '— select a model —' : '— daemon unreachable —'}</option>
              <OllamaOptions models={models} />
            </select>
          </label>

          {/* Per-role overrides — give planner/executor/reviewer/docs their own model. */}
          <div className="mt-3">
            <span className="eyebrow">Per-Role Models</span>
            <p className="mt-0.5 text-2xs text-faint">
              Optional — each orchestrator role can run its own model. Blank = the default above.
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {ORCHESTRATOR_ROLES.map((role) => (
                <div key={role} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-2xs uppercase tracking-wider text-muted" title={ROLE_PHASE[role]}>
                    {role}
                  </span>
                  <select
                    value={cfg.ollamaRoleModels?.[role] ?? ''}
                    disabled={!canEdit || !reachable || models.length === 0}
                    aria-label={`${role} model`}
                    onChange={(e) => setCfg({ ollamaRoleModels: { ...cfg.ollamaRoleModels, [role]: e.target.value } })}
                    className="tabular min-w-0 flex-1 rounded-sm border border-hairline bg-bg-deep px-2 py-1 text-xs text-text focus-ring disabled:opacity-60"
                  >
                    <option value="">Use default{cfg.ollamaModel ? ` · ${cfg.ollamaModel}` : ''}</option>
                    <OllamaOptions models={models} />
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={!canEdit || loading}
              onClick={() => void refresh(cfg.ollamaBaseUrl)}
              className="rounded-sm border border-hairline bg-surface-2 px-2.5 py-1 text-2xs uppercase tracking-wider text-text transition-colors hover:border-accent-cyan/45 hover:text-accent-cyan focus-ring disabled:opacity-60"
            >
              {loading ? 'Testing…' : 'Test connection'}
            </button>
            {!reachable && !loading && (
              <span className="text-2xs text-faint">
                Start it with <span className="tabular text-muted">ollama serve</span>
                {tags?.error ? ` · ${tags.error}` : ''}
              </span>
            )}
          </div>
          <ReadOnlyHint>
            Models come from <span className="tabular">{cfg.ollamaBaseUrl}/api/tags</span>. Pull more with{' '}
            <span className="tabular text-muted">ollama pull &lt;model&gt;</span>. Tool-capable models loop best.
          </ReadOnlyHint>
        </div>
      )}

      {/* Claude configuration */}
      {cfg.provider === 'claude' && (
        <div className="panel p-3">
          <SectionLabel
            right={
              <span className="tabular text-2xs uppercase" style={{ color: accentVar(cfg.anthropicApiKey ? 'green' : 'amber') }}>
                {cfg.anthropicApiKey ? '● KEY SET' : '● NO KEY'}
              </span>
            }
          >
            Anthropic API
          </SectionLabel>

          <label className="mt-3 block">
            <span className="eyebrow">API Key</span>
            <input
              type="password"
              value={cfg.anthropicApiKey}
              disabled={!canEdit}
              spellCheck={false}
              placeholder="sk-ant-…"
              autoComplete="off"
              onChange={(e) => setCfg({ anthropicApiKey: e.target.value })}
              className="tabular mt-1 w-full rounded-sm border border-hairline bg-bg-deep px-2 py-1 text-xs text-text focus-ring disabled:opacity-60"
            />
          </label>

          <label className="mt-3 block">
            <span className="eyebrow">Model</span>
            <select
              value={cfg.claudeModel}
              disabled={!canEdit}
              onChange={(e) => setCfg({ claudeModel: e.target.value })}
              className="tabular mt-1 w-full rounded-sm border border-hairline bg-bg-deep px-2 py-1 text-xs text-text focus-ring disabled:opacity-60"
            >
              {CLAUDE_MODELS.map((m) => (
                <option key={m.id || 'tiered'} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <ReadOnlyHint>
            Your Claude Code login is a subscription, not an API key — paste an{' '}
            <span className="tabular text-muted">sk-ant-…</span> key from the Anthropic console. It&apos;s stored locally
            and sent only to your own run; it never touches a server.
          </ReadOnlyHint>
        </div>
      )}

      {!canEdit && <ReadOnlyHint>Changing the AI provider requires Operator or higher.</ReadOnlyHint>}
    </div>
  );
}

function ProviderCard({
  active,
  disabled,
  onClick,
  title,
  sub,
  accent,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  accent: 'green' | 'purple';
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-sm border px-3 py-2.5 text-left transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-60',
        active ? 'border-accent-cyan/50 bg-accent-cyan/10' : 'border-hairline bg-surface-2 hover:border-hairline-strong',
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentVar(accent) }} aria-hidden />
        <span className="text-xs text-text">{title}</span>
      </span>
      <span className="text-2xs text-muted">{sub}</span>
    </button>
  );
}

// ── Defaults ───────────────────────────────────────────────────────────────────
function DefaultsPane() {
  const canEdit = useCan('loop.config.edit');
  return (
    <div className="panel p-3">
      <SectionLabel>Workspace Defaults</SectionLabel>
      <div className="mt-3 flex flex-col gap-2 text-xs">
        <DefRow k="Default cadence" v="CONTINUOUS" />
        <DefRow k="Default run mode" v="AUTO (single-step on demand)" />
        <DefRow k="Escalation" v="ON · 1 tier on repeated gate failure, decays on a clean pass" />
        <DefRow k="No-progress detector" v="H = 3 stalled cycles → auto-pause" />
        <DefRow k="Batch reviews" v="ON · CEO sweeps at 50% (Batch API)" />
      </div>
      {!canEdit && <ReadOnlyHint>Editing workspace defaults requires Operator or higher.</ReadOnlyHint>}
    </div>
  );
}
function DefRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline/60 py-1.5 last:border-0">
      <span className="text-muted">{k}</span>
      <span className="tabular text-2xs text-text">{v}</span>
    </div>
  );
}

// ── Gate thresholds (org defaults) ───────────────────────────────────────────────
function GatesPane() {
  const canEdit = useCan('gate.threshold.edit');
  const overrides = useCockpit((s) => s.gateThresholds.org);
  const setGateThreshold = useCockpit((s) => s.setGateThreshold);
  const thresholdOf = (cat: RubricCategory) => overrides?.[cat] ?? DEFAULT_GATE_THRESHOLD;
  const avg = Math.round(
    RUBRIC_CATEGORIES.reduce((sum, c) => sum + thresholdOf(c), 0) / RUBRIC_CATEGORIES.length,
  );
  return (
    <div className="panel p-3">
      <SectionLabel right={<span className="tabular text-2xs text-faint">AVG {avg}%</span>}>
        Org Gate Thresholds — Health % = rolling gate pass rate
      </SectionLabel>
      <ul className="mt-3 flex flex-col gap-3">
        {RUBRIC_CATEGORIES.map((cat) => {
          const color = accentVar(rubricAccent[cat]);
          const v = thresholdOf(cat);
          return (
            <li key={cat}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs text-muted">{RUBRIC_CATEGORY_LABELS[cat]}</span>
                <span className="tabular text-2xs" style={{ color }}>
                  {v}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={v}
                disabled={!canEdit}
                aria-label={`${RUBRIC_CATEGORY_LABELS[cat]} org threshold`}
                onChange={(e) => setGateThreshold('org', cat, Number(e.target.value))}
                className="h-1 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                style={{ color }}
              />
            </li>
          );
        })}
      </ul>
      {!canEdit && <ReadOnlyHint>Threshold editing requires the Commander role.</ReadOnlyHint>}
    </div>
  );
}

// ── Members & roles ──────────────────────────────────────────────────────────────
function MembersPane() {
  const actor = useUserRole();
  const canManage = useCan('members.manage');
  return (
    <div className="panel p-3">
      <SectionLabel right={<span className="tabular text-2xs text-faint">{MEMBERS.length} MEMBERS</span>}>
        Members &amp; Roles · {LOCAL_ORG.name}
      </SectionLabel>
      <div className="mt-3 overflow-hidden rounded-sm border border-hairline">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline bg-surface-2">
              <th className="eyebrow px-2 py-1 font-normal">Member</th>
              <th className="eyebrow px-2 py-1 font-normal">Email</th>
              <th className="eyebrow px-2 py-1 text-right font-normal">Role</th>
            </tr>
          </thead>
          <tbody>
            {MEMBERS.map((m) => (
              <tr key={m.id} className="border-b border-hairline/60 last:border-0">
                <td className="px-2 py-1.5 text-xs text-text">{m.name}</td>
                <td className="tabular max-w-[12rem] truncate px-2 py-1.5 text-2xs text-muted">{m.email}</td>
                <td className="px-2 py-1.5 text-right">
                  {canManage ? (
                    <select
                      defaultValue={m.role}
                      aria-label={`${m.name} role`}
                      className="tabular rounded-sm border border-hairline bg-bg-deep px-1.5 py-0.5 text-2xs uppercase text-text focus-ring"
                      onChange={(e) => {
                        void fetch(`/api/org/members/${encodeURIComponent(m.id)}`, {
                          method: 'PATCH',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ role: e.target.value }),
                        }).catch(() => {
                          /* optimistic — durable write is the gateway */
                        });
                      }}
                    >
                      {ROLES_BY_SENIORITY.map((r) => (
                        <option key={r} value={r} disabled={r !== m.role && !canAssignRole(actor, r)}>
                          {USER_ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="tabular text-2xs uppercase text-muted">{USER_ROLE_LABELS[m.role]}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!canManage && <ReadOnlyHint>Managing members &amp; roles requires the Owner role.</ReadOnlyHint>}
    </div>
  );
}

// ── Billing & limits (per-org budget dashboard) ──────────────────────────────────
function BillingPane() {
  const canEdit = useCan('budget.cap.edit');
  const tree = useLoopTree();
  const { agg, loops } = useMemo(() => {
    const forest = rollupForest(tree);
    return { agg: aggregate(forest), loops: forest.flatMap(flattenRollup) };
  }, [tree]);
  const util = agg.totalBudgetUsd > 0 ? agg.totalSpentUsd / agg.totalBudgetUsd : 0;
  const utilAccent = util >= 0.95 ? 'red' : util >= 0.8 ? 'amber' : 'green';
  const byspend = [...loops].sort((a, b) => b.loop.spentUsd - a.loop.spentUsd).slice(0, 8);

  return (
    <div className="flex flex-col gap-3">
      <div className="panel p-3">
        <SectionLabel right={<span className="tabular text-2xs" style={{ color: accentVar(utilAccent) }}>{Math.round(util * 100)}%</span>}>
          Org Budget · {LOCAL_ORG.name}
        </SectionLabel>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Kpi label="Spend" value={usd(agg.totalSpentUsd)} accent={accentVar(utilAccent)} />
          <Kpi label="Hard Cap" value={usd(agg.totalBudgetUsd)} />
          <Kpi label="Headroom" value={usd(Math.max(0, agg.totalBudgetUsd - agg.totalSpentUsd))} />
        </div>
        {/* spend bar with soft-cap (80%) tick */}
        <div className="relative mt-3 h-2 w-full overflow-hidden rounded-full border border-hairline bg-bg-deep">
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, util * 100)}%`, backgroundColor: accentVar(utilAccent) }} aria-hidden />
          <div className="absolute inset-y-0 w-px bg-faint" style={{ left: '80%' }} aria-hidden />
        </div>
        <div className="mt-1 flex justify-between">
          <span className="tabular text-2xs text-faint">$0</span>
          <span className="tabular text-2xs text-faint">soft 80%</span>
          <span className="tabular text-2xs text-faint">{usd(agg.totalBudgetUsd)}</span>
        </div>
      </div>

      <div className="panel p-3">
        <SectionLabel>Per-Loop Allocation (top spenders)</SectionLabel>
        <ul className="mt-3 flex flex-col gap-2">
          {byspend.map((n) => {
            const u = n.loop.budgetCapUsd > 0 ? n.loop.spentUsd / n.loop.budgetCapUsd : 0;
            const acc = u >= 0.95 ? 'red' : u >= 0.8 ? 'amber' : 'green';
            return (
              <li key={n.loop.id} className="flex items-center gap-2">
                <span className="w-32 shrink-0 truncate text-xs text-muted">{n.loop.displayName}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full border border-hairline bg-bg-deep">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, u * 100)}%`, backgroundColor: accentVar(acc) }} />
                </div>
                <span className="tabular w-24 shrink-0 text-right text-2xs text-faint">
                  {usd(n.loop.spentUsd)}/{usd(n.loop.budgetCapUsd)}
                </span>
              </li>
            );
          })}
        </ul>
        {!canEdit && <ReadOnlyHint>Editing budget caps requires the Commander role.</ReadOnlyHint>}
      </div>
    </div>
  );
}
function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface-2 p-2.5">
      <span className="eyebrow">{label}</span>
      <span className="tabular text-lg leading-none text-text" style={accent ? { color: accent } : undefined}>{value}</span>
    </div>
  );
}

// ── Integrations ─────────────────────────────────────────────────────────────────
function IntegrationsPane() {
  const canManage = useCan('integrations.manage');
  const services: { name: string; status: 'connected' | 'gated' }[] = [
    { name: 'CMA (Managed Agents)', status: 'gated' },
    { name: 'Temporal', status: 'gated' },
    { name: 'Redis Streams', status: 'gated' },
    { name: 'Postgres + pgvector', status: 'gated' },
  ];
  // Credentials are referenced by VAULT HANDLE — never a raw secret (egress injection).
  const creds = [
    { name: 'GitHub', ref: 'vault://southbay/github-token' },
    { name: 'Slack', ref: 'vault://southbay/slack-bot-token' },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="panel p-3">
        <SectionLabel>Service Connections</SectionLabel>
        <ul className="mt-3 flex flex-col gap-2">
          {services.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-3 border-b border-hairline/60 py-1.5 last:border-0">
              <span className="text-xs text-muted">{s.name}</span>
              <span
                className="tabular rounded-sm border px-1.5 py-0.5 text-2xs uppercase"
                style={{
                  color: accentVar(s.status === 'connected' ? 'green' : 'amber'),
                  borderColor: `color-mix(in oklab, ${accentVar(s.status === 'connected' ? 'green' : 'amber')} 40%, transparent)`,
                }}
              >
                {s.status === 'connected' ? 'CONNECTED' : 'GATED (docker/creds)'}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="panel p-3">
        <SectionLabel>Credentials (CMA Vault refs — no secrets in the app)</SectionLabel>
        <ul className="mt-3 flex flex-col gap-2">
          {creds.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-3 border-b border-hairline/60 py-1.5 last:border-0">
              <span className="text-xs text-muted">{c.name}</span>
              <span className="tabular text-2xs text-faint">{c.ref}</span>
            </li>
          ))}
        </ul>
        {!canManage && <ReadOnlyHint>Managing integrations &amp; credentials requires the Owner role.</ReadOnlyHint>}
      </div>
    </div>
  );
}
