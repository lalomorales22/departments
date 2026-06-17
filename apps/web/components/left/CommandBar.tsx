'use client';

import { type FormEvent, useState } from 'react';
import { Kbd } from '@/components/atoms';
import { LOOPS } from '@/lib/fixtures';
import { useCockpit } from '@/lib/store';

/**
 * The `> loop <name>` command input. A panel-inset row with a mono cyan prompt glyph,
 * a borderless input, and a faint Enter hint. On submit we resolve the typed name
 * against the loop roster (matching either the one-word handle or the display name)
 * and focus that loop. No match = no-op (purely visual entry affordance).
 */
export function CommandBar() {
  const setSelectedLoop = useCockpit((s) => s.setSelectedLoop);
  const [value, setValue] = useState('');

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    // Accept either "loop marketing" or just "marketing".
    const query = raw.replace(/^loop\s+/i, '').trim().toLowerCase();
    if (!query) return;
    const match = LOOPS.find(
      (l) => l.name.toLowerCase() === query || l.displayName.toLowerCase() === query,
    );
    if (match) {
      setSelectedLoop(match.id);
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
        placeholder="loop <anything>"
        aria-label="Loop command"
        className="min-w-0 flex-1 border-0 bg-transparent font-mono text-sm text-text outline-none placeholder:text-faint"
      />
      <Kbd className="shrink-0 opacity-60">Enter</Kbd>
    </form>
  );
}
