'use client';

import { ShieldAlert, GitBranchPlus, Check, X, Play, Lock } from 'lucide-react';
import { usePendingApprovals, useRunStatus } from '@/lib/live';
import { useRealtime } from '@/lib/realtime';
import { useCan } from '@/lib/rbac';

/**
 * The Commander APPROVAL surface (human-on-top guardrail). When an `--approvals` run
 * pauses on an irreversible tool (always_ask) or a child-spawn request, this banner
 * surfaces it with Approve / Deny — the verdict is POSTed to /decide and written to the
 * engine. When idle it offers a one-click "run with approvals" so the gate is reachable.
 */
export function ApprovalBanner({ loopId }: { loopId: string }) {
  const pending = usePendingApprovals(loopId);
  const runStatus = useRunStatus(loopId);
  const decide = useRealtime((s) => s.decide);
  const runLoop = useRealtime((s) => s.runLoop);
  // The approval gates are the Commander's kill-switch authority. Operators/Viewers see
  // the pending request read-only ("awaiting a Commander"); only a Commander may decide.
  const canApprove = useCan('approval.tool');
  const canRun = useCan('loop.run');

  const hasPending = pending.tool || pending.spawn;

  if (!hasPending) {
    if (runStatus === 'running' || !canRun) return null; // running, or this role can't start one
    return (
      <button
        type="button"
        onClick={() => void runLoop(loopId, { approvals: true })}
        className="flex items-center gap-2 self-start rounded-sm border border-hairline bg-surface-2 px-2.5 py-1 text-2xs uppercase tracking-wider text-muted transition-colors hover:text-text focus-ring"
        title="Run a cycle that pauses for Commander approval on irreversible actions + child spawns"
      >
        <Play className="h-3 w-3" strokeWidth={2} /> Run with approvals
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {pending.spawn && (
        <ApprovalCard
          icon={<GitBranchPlus className="h-4 w-4 shrink-0 text-accent-purple" strokeWidth={2} />}
          title="Child-spawn approval required"
          detail={pending.spawn.message}
          canApprove={canApprove}
          onApprove={() => void decide(loopId, 'spawn', true)}
          onDeny={() => void decide(loopId, 'spawn', false)}
        />
      )}
      {pending.tool && (
        <ApprovalCard
          icon={<ShieldAlert className="h-4 w-4 shrink-0 text-accent-amber" strokeWidth={2} />}
          title={`always_ask — confirm "${pending.tool.tool}"`}
          detail={pending.tool.summary}
          canApprove={canApprove}
          onApprove={() => void decide(loopId, 'tool', true)}
          onDeny={() => void decide(loopId, 'tool', false)}
        />
      )}
    </div>
  );
}

function ApprovalCard({
  icon,
  title,
  detail,
  canApprove,
  onApprove,
  onDeny,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  canApprove: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="panel flex items-center gap-3 border-l-2 border-accent-amber px-3 py-2 shadow-glow-amber">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-text">{title}</p>
        <p className="truncate text-2xs text-muted">{detail}</p>
      </div>
      {canApprove ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onDeny}
            className="flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-2xs uppercase tracking-wider text-muted transition-colors hover:border-accent-red/40 hover:text-accent-red focus-ring"
          >
            <X className="h-3 w-3" strokeWidth={2} /> Deny
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="flex items-center gap-1 rounded-sm border border-accent-green/40 bg-accent-green/10 px-2 py-1 text-2xs uppercase tracking-wider text-accent-green transition-colors hover:bg-accent-green/20 focus-ring"
          >
            <Check className="h-3 w-3" strokeWidth={2} /> Approve
          </button>
        </div>
      ) : (
        <span
          className="flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-2xs uppercase tracking-wider text-faint"
          title="Only a Commander can answer this gate"
        >
          <Lock className="h-3 w-3" strokeWidth={2} /> Awaiting a Commander
        </span>
      )}
    </div>
  );
}
