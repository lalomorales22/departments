'use client';

import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { ListPlus, Plus, Settings2, UserPlus, X } from 'lucide-react';
import { SectionLabel } from '@/components/atoms';
import { useLoops, useLoopRegistry } from '@/lib/loops-client';
import { useAgentRoster } from '@/lib/roster';
import { useCockpit } from '@/lib/store';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';

/**
 * The dedicated creation modals (Phase 8): ⌘N New Loop · ⌘A New Agent · ⌘T New Task.
 * Each opens its OWN modal from the store flags (no longer the ⌘K search window). Mounted
 * once in the AppShell; only the open one renders.
 */
export function CreationModals() {
  const newLoopOpen = useCockpit((s) => s.newLoopOpen);
  const newAgentOpen = useCockpit((s) => s.newAgentOpen);
  const newTaskOpen = useCockpit((s) => s.newTaskOpen);
  return (
    <>
      {newLoopOpen && <NewLoopModal />}
      {newAgentOpen && <NewAgentModal />}
      {newTaskOpen && <NewTaskModal />}
    </>
  );
}

// ── shared shell ───────────────────────────────────────────────────────────────

function ModalShell({
  title,
  icon: Icon,
  onClose,
  children,
}: {
  title: string;
  icon: typeof Plus;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-bg/70 p-4 pt-24 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="panel w-full max-w-lg animate-fade-in p-4"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>
            <span className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 text-accent-cyan" strokeWidth={2} aria-hidden />
              {title}
            </span>
          </SectionLabel>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-faint hover:text-text focus-ring"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const FIELD_LABEL = 'mb-1 block text-2xs uppercase tracking-wider text-faint';
const FIELD =
  'w-full rounded-sm border border-hairline bg-bg-deep px-2 py-1.5 text-xs text-text focus-ring';

function PrimaryButton({
  onClick,
  disabled,
  icon: Icon,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  icon: typeof Plus;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-2xs uppercase tracking-wider transition-colors focus-ring',
        !disabled
          ? 'border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20'
          : 'cursor-not-allowed border-hairline text-faint',
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} /> {children}
    </button>
  );
}

function CancelButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="rounded-sm border border-hairline px-3 py-1.5 text-2xs uppercase tracking-wider text-muted hover:text-text focus-ring"
    >
      Cancel
    </button>
  );
}

// ── New Loop (fully backed — creates a persisted department) ─────────────────────

function NewLoopModal() {
  const close = useCockpit((s) => s.setNewLoopOpen);
  const enterLoop = useCockpit((s) => s.enterLoop);
  const createLoop = useLoopRegistry((s) => s.create);
  const loops = useLoops();

  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [level, setLevel] = useState(1);
  const [parentLoopId, setParentLoopId] = useState('');
  const [busy, setBusy] = useState(false);

  const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
  const dup = loops.some((l) => l.name.toLowerCase() === slug);
  const valid = slug.length > 0 && !dup && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const loop = await createLoop({
      name: name.trim(),
      mission: mission.trim() || undefined,
      level,
      parentLoopId: parentLoopId || null,
    });
    setBusy(false);
    if (loop) {
      toast.success(`Created department “${loop.displayName}”.`);
      close(false);
      enterLoop(loop.id);
    } else {
      toast.error(`Couldn't create “${name.trim()}”.`);
    }
  }

  return (
    <ModalShell title="New Loop" icon={Plus} onClose={() => close(false)}>
      <form onSubmit={submit}>
        <label className={FIELD_LABEL} htmlFor="new-loop-name">
          Name
        </label>
        <input
          id="new-loop-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="marketing"
          className={cn(FIELD, 'mb-1 font-mono')}
        />
        <p className="mb-3 text-2xs text-faint">
          {dup ? (
            <span className="text-accent-red">A department named “{slug}” already exists.</span>
          ) : (
            <>
              A persistent department that owns one mission and runs the loop cycle.{' '}
              {slug && <span className="font-mono text-muted">id: {slug}</span>}
            </>
          )}
        </p>

        <label className={FIELD_LABEL} htmlFor="new-loop-mission">
          Mission <span className="text-faint">(optional)</span>
        </label>
        <textarea
          id="new-loop-mission"
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          rows={3}
          placeholder="Increase brand awareness & drive qualified traffic."
          className={cn(FIELD, 'mb-3 resize-none leading-relaxed')}
        />

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className={FIELD_LABEL} htmlFor="new-loop-level">
              Level
            </label>
            <select
              id="new-loop-level"
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              className={FIELD}
            >
              <option value={1}>L1 — Company Department</option>
              <option value={2}>L2 — Business / Product Unit</option>
              <option value={3}>L3 — Execution Department</option>
              <option value={4}>L4 — Worker Loop</option>
            </select>
          </div>
          <div>
            <label className={FIELD_LABEL} htmlFor="new-loop-parent">
              Parent <span className="text-faint">(optional)</span>
            </label>
            <select
              id="new-loop-parent"
              value={parentLoopId}
              onChange={(e) => setParentLoopId(e.target.value)}
              className={FIELD}
            >
              <option value="">— none (top level) —</option>
              {loops.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.displayName} (L{l.level})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <CancelButton onClose={() => close(false)} />
          <PrimaryButton disabled={!valid} icon={Plus}>
            {busy ? 'Creating…' : 'Create department'}
          </PrimaryButton>
        </div>
      </form>
    </ModalShell>
  );
}

// ── New Agent (honest: the roster is provider-derived, scoped to a loop) ──────────

function NewAgentModal() {
  const close = useCockpit((s) => s.setNewAgentOpen);
  const setTab = useCockpit((s) => s.setTab);
  const setSettingsTab = useCockpit((s) => s.setSettingsTab);
  const selectedLoopId = useCockpit((s) => s.selectedLoopId);
  const loops = useLoops();

  const [loopId, setLoopId] = useState(selectedLoopId || loops[0]?.id || '');
  const roster = useAgentRoster(loopId);

  function toProviderSettings() {
    close(false);
    setSettingsTab('PROVIDER');
    setTab('SETTINGS');
  }

  return (
    <ModalShell title="New Agent" icon={UserPlus} onClose={() => close(false)}>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Every loop runs a fixed canonical roster — <span className="text-text">planner</span>,{' '}
        <span className="text-text">executor</span>, <span className="text-text">reviewer</span>, and{' '}
        <span className="text-text">docs</span> — one role per phase. You don't add agents
        individually; instead you pick the model each role runs in{' '}
        <span className="text-accent-cyan">Settings → AI Provider</span>.
      </p>

      <label className={FIELD_LABEL} htmlFor="new-agent-loop">
        Loop
      </label>
      <select
        id="new-agent-loop"
        value={loopId}
        onChange={(e) => setLoopId(e.target.value)}
        className={cn(FIELD, 'mb-3')}
      >
        {loops.length === 0 && <option value="">— no departments yet —</option>}
        {loops.map((l) => (
          <option key={l.id} value={l.id}>
            {l.displayName} (L{l.level})
          </option>
        ))}
      </select>

      <div className="mb-4 overflow-hidden rounded-sm border border-hairline">
        {roster.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-2 border-b border-hairline px-2.5 py-1.5 text-2xs last:border-b-0"
          >
            <span className="font-mono uppercase tracking-wider text-muted">{a.role}</span>
            <span className="truncate font-mono text-faint">{a.modelId}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <CancelButton onClose={() => close(false)} />
        <button
          type="button"
          onClick={toProviderSettings}
          className="flex items-center gap-1.5 rounded-sm border border-accent-cyan/40 bg-accent-cyan/10 px-3 py-1.5 text-2xs uppercase tracking-wider text-accent-cyan transition-colors hover:bg-accent-cyan/20 focus-ring"
        >
          <Settings2 className="h-3 w-3" strokeWidth={2} /> Configure models
        </button>
      </div>
    </ModalShell>
  );
}

// ── New Task (scoped; honest that persistence isn't wired yet) ────────────────────

function NewTaskModal() {
  const close = useCockpit((s) => s.setNewTaskOpen);
  const selectedLoopId = useCockpit((s) => s.selectedLoopId);
  const loops = useLoops();

  const [loopId, setLoopId] = useState(selectedLoopId || loops[0]?.id || '');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('P2');
  const loopName = useMemo(() => loops.find((l) => l.id === loopId)?.displayName, [loops, loopId]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    // Tasks have no durable store yet — the board projects from the loop's TASKS.md / run
    // events (backlog). Be honest rather than silently dropping the input.
    toast.info(
      `Task tracking isn't wired yet — “${title.trim()}” will come from ${loopName ?? 'the loop'}'s TASKS.md once the board projection lands.`,
    );
    close(false);
  }

  return (
    <ModalShell title="New Task" icon={ListPlus} onClose={() => close(false)}>
      <form onSubmit={submit}>
        <label className={FIELD_LABEL} htmlFor="new-task-loop">
          Loop
        </label>
        <select
          id="new-task-loop"
          value={loopId}
          onChange={(e) => setLoopId(e.target.value)}
          className={cn(FIELD, 'mb-3')}
        >
          {loops.length === 0 && <option value="">— no departments yet —</option>}
          {loops.map((l) => (
            <option key={l.id} value={l.id}>
              {l.displayName} (L{l.level})
            </option>
          ))}
        </select>

        <label className={FIELD_LABEL} htmlFor="new-task-title">
          Title
        </label>
        <input
          id="new-task-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Draft the Q3 launch brief"
          className={cn(FIELD, 'mb-3')}
        />

        <label className={FIELD_LABEL} htmlFor="new-task-priority">
          Priority
        </label>
        <select
          id="new-task-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className={cn(FIELD, 'mb-3')}
        >
          <option value="P1">P1 — urgent</option>
          <option value="P2">P2 — normal</option>
          <option value="P3">P3 — later</option>
        </select>

        <p className="mb-3 rounded-sm border border-hairline bg-surface-2/40 px-2.5 py-2 text-2xs leading-relaxed text-faint">
          Tasks aren't persisted yet — the board projects a loop's work from its{' '}
          <span className="font-mono text-muted">TASKS.md</span> and run events. This captures the
          intent; the durable task store lands with the board projection.
        </p>

        <div className="flex items-center justify-end gap-2">
          <CancelButton onClose={() => close(false)} />
          <PrimaryButton disabled={!title.trim()} icon={ListPlus}>
            Add task
          </PrimaryButton>
        </div>
      </form>
    </ModalShell>
  );
}
