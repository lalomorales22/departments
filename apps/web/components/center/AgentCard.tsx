'use client';

import type { Agent, AgentRole } from '@departments/shared';
import {
  Compass,
  Cpu,
  Crown,
  FileText,
  Gavel,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { StatusDot } from '@/components/atoms';
import { Sparkline } from '@/components/atoms';
import {
  accentVar,
  agentStatusAccent,
  glowVar,
  isLiveAgentStatus,
} from '@/lib/status-theme';
import { useCockpit } from '@/lib/store';
import { cn } from '@/lib/cn';

/** Thin line glyph per agent role (lucide only — never emoji). */
const ROLE_ICON: Record<AgentRole, LucideIcon> = {
  planner: Compass,
  executor: Cpu,
  qa: ShieldCheck,
  docs: FileText,
  reviewer: Gavel,
  coordinator: Crown,
};

/**
 * Compact bordered agent card. Color is rationed: tinted glyph + status dot resolve
 * through `agentStatusAccent`; glow appears only when selected or live, idle agents
 * dim. Clicking toggles selection in the cockpit store.
 */
export function AgentCard({ agent }: { agent: Agent }) {
  const selectedAgentId = useCockpit((s) => s.selectedAgentId);
  const setSelectedAgent = useCockpit((s) => s.setSelectedAgent);

  const accent = agentStatusAccent[agent.status];
  const live = isLiveAgentStatus(agent.status);
  const selected = selectedAgentId === agent.id;
  const idle = agent.status === 'idle';

  const RoleIcon = ROLE_ICON[agent.role];
  const series = agent.activitySeries ?? [];

  return (
    <button
      type="button"
      onClick={() => setSelectedAgent(agent.id)}
      aria-pressed={selected}
      style={selected ? { boxShadow: glowVar('cyan') } : undefined}
      className={cn(
        'focus-ring group flex w-full flex-col gap-2.5 rounded border border-hairline bg-surface p-3 text-left transition-colors',
        'hover:border-hairline-strong hover:bg-surface-2',
        selected && 'border-accent-cyan bg-surface-2',
        idle && !selected && 'opacity-70',
      )}
    >
      {/* Top row: role glyph · name · status dot */}
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-hairline bg-surface-3"
          style={{ color: accentVar(accent) }}
        >
          <RoleIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
          {agent.name}
        </span>
        <StatusDot accent={accent} live={live} size={7} />
      </div>

      {/* Second row: model id + effort (machine values) */}
      <div className="tabular flex items-center gap-1.5 text-2xs text-muted">
        <span className="truncate">{agent.modelId}</span>
        {agent.effort != null && (
          <span className="text-faint">· {agent.effort}</span>
        )}
      </div>

      {/* Third: current activity, clamped to 2 lines */}
      {agent.activity != null && (
        <p className="line-clamp-2 text-xs leading-snug text-muted">
          {agent.activity}
        </p>
      )}

      {/* Footer: recent activity sparkline */}
      <Sparkline
        data={series}
        accent={accent}
        width={240}
        height={20}
        fill
        className="mt-0.5 w-full"
      />
    </button>
  );
}
