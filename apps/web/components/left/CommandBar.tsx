'use client';

import { type FormEvent, useState } from 'react';
import { Play } from 'lucide-react';
import { Kbd } from '@/components/atoms';
import { useLoops, useLoopRegistry } from '@/lib/loops-client';
import { useCockpit } from '@/lib/store';
import { useRealtime } from '@/lib/realtime';
import { accentVar } from '@/lib/status-theme';
import { toast } from '@/lib/toast';

/**
 * The `> loop <name>` command input — the way you create and focus departments.
 *   `loop <name>`  → focus that department, CREATING it if it doesn't exist yet.
 *   `run <name>`   → focus (creating if needed) and fire one real engine cycle.
 *   ▶ button       → run one cycle of the currently selected loop.
 * A real cycle's events stream live into the console; the loop is persisted to the DB.
 */
export function CommandBar() {
  const enterLoop = useCockpit((s) => s.enterLoop);
  const selectedLoopId = useCockpit((s) => s.selectedLoopId);
  const runLoop = useRealtime((s) => s.runLoop);
  const running = useRealtime((s) => s.runStatus[selectedLoopId] === 'running');
  const loops = useLoops();
  const createLoop = useLoopRegistry((s) => s.create);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw || busy) return;
    const isRun = /^run\b/i.test(raw);
    const query = raw.replace(/^(run|loop)\s+/i, '').trim();
    const q = query.toLowerCase();
    setValue('');

    let target = query
      ? loops.find((l) => l.name.toLowerCase() === q || l.displayName.toLowerCase() === q)
      : isRun
        ? loops.find((l) => l.id === selectedLoopId)
        : undefined;

    // `loop <new name>` CREATES a real department (persisted to the DB) and focuses it.
    if (!target && query) {
      setBusy(true);
      target = (await createLoop({ name: query })) ?? undefined;
      setBusy(false);
      if (target) toast.success(`Created department “${target.displayName}”.`);
      else {
        toast.error(`Couldn't create “${query}”.`);
        return;
      }
    }
    if (target) {
      enterLoop(target.id);
      if (isRun) void runLoop(target.id);
    } else if (query) {
      toast.info(`No department matches “${query}”.`);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="panel-inset flex items-center gap-2 px-2.5 py-1.5 focus-within:shadow-glow-cyan"
    >
      <span className="select-none font-mono text-sm leading-none text-accent-cyan" aria-hidden>
        &gt;
      </span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        placeholder="loop &lt;anything&gt;   ·   run &lt;name&gt;"
        aria-label="Loop command"
        className="min-w-0 flex-1 border-0 bg-transparent font-mono text-sm text-text outline-none placeholder:text-faint"
      />
      <button
        type="button"
        onClick={() => selectedLoopId && void runLoop(selectedLoopId)}
        disabled={running || !selectedLoopId}
        aria-label="Run selected loop"
        title="Run one cycle of the selected loop"
        className="focus-ring shrink-0 rounded-sm border border-hairline bg-surface-2 p-1 text-muted hover:border-hairline-strong hover:text-text disabled:opacity-40"
        style={running ? { color: accentVar('green'), borderColor: accentVar('green') } : undefined}
      >
        <Play className="h-3 w-3" strokeWidth={2} fill={running ? 'currentColor' : 'none'} />
      </button>
      <Kbd className="shrink-0 opacity-60">Enter</Kbd>
    </form>
  );
}
