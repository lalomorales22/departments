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
import { Plus, Trash2 } from 'lucide-react';
import { SectionLabel } from '@/components/atoms';
import { useLoopTree } from '@/lib/loops-client';
import { useMembers, useMembersRegistry } from '@/lib/members-client';
import { LOCAL_COMMANDER, LOCAL_ORG } from '@/lib/workspace';
import { aggregate, flattenRollup, rollupForest } from '@/lib/tree';
import { accentVar, rubricAccent } from '@/lib/status-theme';
import { useCockpit, SETTINGS_TABS, ORCHESTRATOR_ROLES, type SettingsTab } from '@/lib/store';
import { useCan, useUserRole } from '@/lib/rbac';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';

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
  const members = useMembers();
  const { hydrate, setRole, remove } = useMembersRegistry();

  // Hydrate the real roster once (seeded server-side with just the local commander).
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const ownerCount = members.filter((m) => m.role === 'owner').length;

  async function onDelete(id: string, name: string) {
    const res = await remove(id);
    if (res.ok) toast.success(`Removed ${name}.`);
    else toast.error(res.error ?? 'Could not remove member.');
  }

  return (
    <div className="panel p-3">
      <SectionLabel right={<span className="tabular text-2xs text-faint">{members.length} MEMBERS</span>}>
        Members &amp; Roles · {LOCAL_ORG.name}
      </SectionLabel>

      <div className="mt-3 overflow-hidden rounded-sm border border-hairline">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline bg-surface-2">
              <th className="eyebrow px-2 py-1 font-normal">Member</th>
              <th className="eyebrow px-2 py-1 font-normal">Email</th>
              <th className="eyebrow px-2 py-1 text-right font-normal">Role</th>
              {canManage && <th className="eyebrow px-2 py-1 text-right font-normal">·</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isSelf = m.id === LOCAL_COMMANDER.id;
              const lastOwner = m.role === 'owner' && ownerCount <= 1;
              const canEditRole = canManage && canAssignRole(actor, m.role);
              const blockReason = isSelf ? "That's you" : lastOwner ? 'Last owner' : undefined;
              return (
                <tr key={m.id} className="border-b border-hairline/60 last:border-0">
                  <td className="px-2 py-1.5 text-xs text-text">
                    {m.name}
                    {isSelf && <span className="ml-1.5 text-2xs text-faint">(you)</span>}
                  </td>
                  <td className="tabular max-w-[12rem] truncate px-2 py-1.5 text-2xs text-muted">{m.email}</td>
                  <td className="px-2 py-1.5 text-right">
                    {canEditRole ? (
                      <select
                        value={m.role}
                        aria-label={`${m.name} role`}
                        className="tabular rounded-sm border border-hairline bg-bg-deep px-1.5 py-0.5 text-2xs uppercase text-text focus-ring"
                        onChange={(e) => void setRole(m.id, e.target.value as UserRole)}
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
                  {canManage && (
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => void onDelete(m.id, m.name)}
                        disabled={isSelf || lastOwner}
                        aria-label={`Remove ${m.name}`}
                        title={blockReason ? `Can't remove: ${blockReason.toLowerCase()}` : `Remove ${m.name}`}
                        className="rounded-sm p-1 text-faint transition-colors hover:text-accent-red focus-ring disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-faint"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <AddMemberForm actor={actor} />
      ) : (
        <ReadOnlyHint>Managing members &amp; roles requires the Owner role.</ReadOnlyHint>
      )}
    </div>
  );
}

/** Inline add-member form (name + email + a role the actor is allowed to assign). */
function AddMemberForm({ actor }: { actor: UserRole }) {
  const add = useMembersRegistry((s) => s.add);
  const assignable = ROLES_BY_SENIORITY.filter((r) => canAssignRole(actor, r));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>(assignable[assignable.length - 1] ?? 'viewer');
  const [busy, setBusy] = useState(false);

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const valid = name.trim().length > 0 && emailValid && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const res = await add({ name: name.trim(), email: email.trim(), role });
    setBusy(false);
    if (res.ok) {
      toast.success(`Added ${name.trim()}.`);
      setName('');
      setEmail('');
    } else {
      toast.error(res.error ?? 'Could not add member.');
    }
  }

  if (assignable.length === 0) {
    return <ReadOnlyHint>Your role can't assign any roles below it.</ReadOnlyHint>;
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        aria-label="New member name"
        className="min-w-[8rem] flex-1 rounded-sm border border-hairline bg-bg-deep px-2 py-1.5 text-xs text-text focus-ring"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email@workspace"
        aria-label="New member email"
        className="min-w-[10rem] flex-1 rounded-sm border border-hairline bg-bg-deep px-2 py-1.5 text-xs text-text focus-ring"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as UserRole)}
        aria-label="New member role"
        className="tabular rounded-sm border border-hairline bg-bg-deep px-1.5 py-1.5 text-2xs uppercase text-text focus-ring"
      >
        {assignable.map((r) => (
          <option key={r} value={r}>
            {USER_ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={!valid}
        className={cn(
          'flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-2xs uppercase tracking-wider transition-colors focus-ring',
          valid
            ? 'border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20'
            : 'cursor-not-allowed border-hairline text-faint',
        )}
      >
        <Plus className="h-3 w-3" strokeWidth={2} /> {busy ? 'Adding…' : 'Add member'}
      </button>
    </form>
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

/** Honest connection states for a local-first app. */
type IntegrationStatus = 'live' | 'configured' | 'offline' | 'gated';

const STATUS_META: Record<IntegrationStatus, { label: string; accent: 'green' | 'amber' | 'faint' }> = {
  live: { label: 'CONNECTED', accent: 'green' },
  configured: { label: 'CONFIGURED', accent: 'green' },
  offline: { label: 'NOT REACHABLE', accent: 'amber' },
  gated: { label: 'NOT CONFIGURED · DOCKER/CREDS', accent: 'faint' },
};

function StatusChip({ status }: { status: IntegrationStatus }) {
  const meta = STATUS_META[status];
  if (meta.accent === 'faint') {
    return (
      <span className="tabular rounded-sm border border-hairline px-1.5 py-0.5 text-2xs uppercase text-faint">
        {meta.label}
      </span>
    );
  }
  const c = accentVar(meta.accent);
  return (
    <span
      className="tabular rounded-sm border px-1.5 py-0.5 text-2xs uppercase"
      style={{ color: c, borderColor: `color-mix(in oklab, ${c} 40%, transparent)` }}
    >
      {meta.label}
    </span>
  );
}

function IntegrationsPane() {
  const canManage = useCan('integrations.manage');
  const cfg = useCockpit((s) => s.providerConfig);
  const [ollama, setOllama] = useState<{ reachable: boolean; count: number } | null>(null);

  // Live check: is the local Ollama daemon actually reachable? (Real connection, no Docker.)
  useEffect(() => {
    let cancelled = false;
    setOllama(null);
    void fetch(`/api/ollama/models?baseUrl=${encodeURIComponent(cfg.ollamaBaseUrl)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ reachable: boolean; models: unknown[] }>) : null))
      .then((d) => {
        if (!cancelled) setOllama({ reachable: !!d?.reachable, count: d?.models?.length ?? 0 });
      })
      .catch(() => {
        if (!cancelled) setOllama({ reachable: false, count: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [cfg.ollamaBaseUrl]);

  const ollamaStatus: IntegrationStatus = ollama == null ? 'offline' : ollama.reachable ? 'live' : 'offline';
  const claudeStatus: IntegrationStatus = cfg.anthropicApiKey.trim() ? 'configured' : 'gated';

  // Local-first: the two model backends can connect NOW; the prod data plane is genuinely
  // gated behind Docker + creds — labeled honestly, not as if broken.
  const services: { name: string; status: IntegrationStatus; note: string }[] = [
    {
      name: 'Ollama (local models)',
      status: ollamaStatus,
      note:
        ollama == null
          ? 'Checking the local daemon…'
          : ollama.reachable
            ? `${cfg.ollamaBaseUrl} · ${ollama.count} model${ollama.count === 1 ? '' : 's'} installed`
            : `${cfg.ollamaBaseUrl} · daemon not reachable — start Ollama`,
    },
    {
      name: 'Claude (Messages API)',
      status: claudeStatus,
      note: claudeStatus === 'configured' ? 'API key set in AI Provider' : 'Add an API key in Settings → AI Provider',
    },
    { name: 'CMA (Managed Agents)', status: 'gated', note: 'Cloud sandbox — requires Anthropic CMA credentials' },
    { name: 'Temporal', status: 'gated', note: 'Durable workflows — requires docker compose up' },
    { name: 'Redis Streams', status: 'gated', note: 'Event transport — requires docker compose up' },
    { name: 'Postgres + pgvector', status: 'gated', note: 'Multi-tenant store — requires docker compose up' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="panel p-3">
        <SectionLabel right={<span className="tabular text-2xs text-faint">LOCAL-FIRST</span>}>
          Service Connections
        </SectionLabel>
        <ul className="mt-3 flex flex-col gap-2.5">
          {services.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-3 border-b border-hairline/60 pb-2.5 last:border-0 last:pb-0">
              <div className="min-w-0">
                <div className="text-xs text-text">{s.name}</div>
                <div className="truncate text-2xs text-faint">{s.note}</div>
              </div>
              <StatusChip status={s.status} />
            </li>
          ))}
        </ul>
      </div>
      <div className="panel p-3">
        <SectionLabel>Credentials</SectionLabel>
        <p className="mt-2 text-2xs leading-relaxed text-faint">
          The local cockpit holds <span className="text-muted">no secrets</span>. In the gated prod
          path, agent credentials live in <span className="font-mono text-muted">CMA Vaults</span> and
          are injected at egress (referenced by handle, e.g.{' '}
          <span className="font-mono text-muted">vault://&lt;org&gt;/github-token</span>) — never stored
          in the app, artifacts, or event history.
        </p>
        {!canManage && <ReadOnlyHint>Managing integrations requires the Owner role.</ReadOnlyHint>}
      </div>
    </div>
  );
}
