'use client';

import { type FormEvent, useState } from 'react';
import { Play } from 'lucide-react';
import { Kbd } from '@/components/atoms';
import { LOOPS, getLoop } from '@/lib/fixtures';
import { useCockpit } from '@/lib/store';
import { useRealtime } from '@/lib/realtime';
import { accentVar } from '@/lib/status-theme';

/**
 * The `> loop <name>` command input. Resolves the typed name against the roster and
 * focuses that loop. Prefix with `run ` (e.g. `run software-builder`) — or hit the ▶
 * button — to actually fire a real engine cycle whose events stream into the console.
 */
export function CommandBar() {
  const setSelectedLoop = useCockpit((s) => s.setSelectedLoop);
  const selectedLoopId = useCockpit((s) => s.selectedLoopId);
  const runLoop = useRealtime((s) => s.runLoop);
  const running = useRealtime((s) => s.runStatus[selectedLoopId] === 'running');
  const [value, setValue] = useState('');

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    const isRun = /^run\b/i.test(raw);
    const query = raw.replace(/^(run|loop)\s+/i, '').trim().toLowerCase();
    const target = query
      ? LOOPS.find((l) => l.name.toLowerCase() === query || l.displayName.toLowerCase() === query)
      : isRun
        ? getLoop(selectedLoopId)
        : undefined;
    if (target) {
      setSelectedLoop(target.id);
      if (isRun) void runLoop(target.id);
      setValue('');
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
        onClick={() => void runLoop(selectedLoopId)}
        disabled={running}
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
