'use client';

import type { ReactNode } from 'react';
import { useCockpit } from '@/lib/store';
import { Kbd, StatusDot } from '@/components/atoms';
import { ORG } from '@/lib/fixtures';

/** A clickable "label Kbd" chord hint in the bottom rail. */
function ChordHint({
  label,
  keyHint,
  onClick,
}: {
  label: string;
  keyHint: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex items-center gap-1 rounded-sm px-1 text-faint transition-colors hover:text-text"
    >
      <span className="uppercase tracking-wider">{label}</span>
      <Kbd>{keyHint}</Kbd>
    </button>
  );
}

/**
 * The bottom rail: chord hints on the left (Debug / Find / Explorer / Map / Help),
 * a live-mock indicator + org label + a fixed mono clock on the right. The clock is a
 * static string by design — never read Date in render (avoids hydration drift).
 */
export function StatusBar() {
  const toggleLeft = useCockpit((s) => s.toggleLeft);
  const setMapFocused = useCockpit((s) => s.setMapFocused);
  const setShortcutSheetOpen = useCockpit((s) => s.setShortcutSheetOpen);

  return (
    <footer className="flex h-rail items-center justify-between gap-4 border-t border-hairline bg-bg px-3 font-mono text-2xs">
      {/* Left: chord hints */}
      <div className="flex items-center gap-1 overflow-hidden">
        <ChordHint label="Debug" keyHint="&#8984;D" />
        <ChordHint label="Find" keyHint="&#8984;F" />
        <ChordHint label="Explorer" keyHint="&#8984;E" onClick={toggleLeft} />
        <ChordHint label="Map" keyHint="&#8984;M" onClick={() => setMapFocused(true)} />
        <ChordHint label="Help" keyHint="?" onClick={() => setShortcutSheetOpen(true)} />
      </div>

      {/* Right: liveness + org + clock */}
      <div className="flex shrink-0 items-center gap-3">
        <span className="flex items-center gap-1.5">
          <StatusDot accent="green" live size={6} />
          <span className="uppercase tracking-wider text-muted">LIVE &#183; MOCK</span>
        </span>
        <span className="hidden h-3 w-px bg-hairline sm:block" aria-hidden />
        <span className="hidden truncate text-faint sm:inline">{ORG.name}</span>
        <span className="hidden h-3 w-px bg-hairline sm:block" aria-hidden />
        <span className="tabular text-muted" suppressHydrationWarning>
          09:14:22
        </span>
      </div>
    </footer>
  );
}
