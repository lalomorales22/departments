'use client';

import { useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { useCockpit } from '@/lib/store';
import { Kbd, SectionLabel } from '@/components/atoms';

interface Shortcut {
  keys: string[];
  label: string;
}

/** Every keyboard chord the cockpit exposes, grouped by intent. */
const SHORTCUTS: Shortcut[] = [
  { keys: ['⌘K'], label: 'Search' },
  { keys: ['⌘P'], label: 'Command palette / run loop' },
  { keys: ['⌘D'], label: 'Debug logs' },
  { keys: ['⌘F'], label: 'Find' },
  { keys: ['⌘E'], label: 'Explorer / tree' },
  { keys: ['⌘M'], label: 'Map' },
  { keys: ['?'], label: 'This sheet' },
  { keys: ['1', '–', '6'], label: 'Switch tabs' },
  { keys: ['['], label: 'Toggle left panel' },
  { keys: [']'], label: 'Toggle right panel' },
  { keys: ['⌘N'], label: 'New loop' },
  { keys: ['⌘A'], label: 'New agent' },
  { keys: ['⌘T'], label: 'New task' },
  { keys: ['⌘I'], label: 'Import artifact' },
];

function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-hairline bg-surface px-2.5 py-1.5">
      <span className="text-2xs text-muted">{shortcut.label}</span>
      <span className="flex shrink-0 items-center gap-0.5">
        {shortcut.keys.map((k, i) =>
          k === '–' ? (
            <span key={i} className="px-0.5 font-mono text-2xs text-faint">
              {k}
            </span>
          ) : (
            <Kbd key={i}>{k}</Kbd>
          ),
        )}
      </span>
    </div>
  );
}

/**
 * Modal listing all shortcuts in a tidy two-column grid. Esc or a backdrop click
 * closes; the same control is reachable from the StatusBar "Help" chord.
 */
export function ShortcutSheet() {
  const open = useCockpit((s) => s.shortcutSheetOpen);
  const setShortcutSheetOpen = useCockpit((s) => s.setShortcutSheetOpen);

  const close = useCallback(() => setShortcutSheetOpen(false), [setShortcutSheetOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={close}
      role="presentation"
    >
      <div
        className="panel w-full max-w-2xl animate-fade-in overflow-hidden shadow-elevation"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Keyboard shortcuts"
      >
        <div className="flex items-center justify-between border-b border-hairline px-3 py-2.5">
          <SectionLabel>KEYBOARD SHORTCUTS</SectionLabel>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="focus-ring grid h-6 w-6 place-items-center rounded-sm text-faint transition-colors hover:bg-surface-2 hover:text-text"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-2">
          {SHORTCUTS.map((s) => (
            <ShortcutRow key={s.label} shortcut={s} />
          ))}
        </div>
      </div>
    </div>
  );
}
