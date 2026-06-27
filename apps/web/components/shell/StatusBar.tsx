'use client';

import { type ReactNode, useEffect, useState } from 'react';
import type { AccentKey } from '@departments/shared';
import type { ConnectionState } from '@departments/realtime';
import { useCockpit } from '@/lib/store';
import { useConnection, useRunStatus } from '@/lib/live';
import { Kbd, StatusDot } from '@/components/atoms';
import { LOCAL_ORG } from '@/lib/workspace';

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

/** Connection state → {accent, label, glow}. Only a healthy live link glows green. */
const CONNECTION_UI: Record<ConnectionState, { accent: AccentKey; label: string; live: boolean }> = {
  idle: { accent: 'blue', label: 'OFFLINE', live: false },
  connecting: { accent: 'cyan', label: 'CONNECTING', live: false },
  live: { accent: 'green', label: 'LIVE', live: true },
  reconnecting: { accent: 'amber', label: 'RECONNECTING', live: false },
  stale: { accent: 'amber', label: 'STALE', live: false },
  error: { accent: 'red', label: 'DISCONNECTED', live: false },
};

/** A live wall clock that only ticks after mount (no SSR/hydration drift). */
function LiveClock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="tabular text-muted" suppressHydrationWarning>
      {now ?? '--:--:--'}
    </span>
  );
}

/**
 * The bottom rail: chord hints on the left (Debug / Find / Explorer / Map / Help), and
 * on the right the REAL realtime connection indicator for the selected loop, the org
 * label, and a live clock. The connection dot reflects the SSE link state
 * (live/reconnecting/stale) — the cockpit's honest liveness signal, not a fixed badge.
 */
export function StatusBar() {
  const toggleLeft = useCockpit((s) => s.toggleLeft);
  const setMapFocused = useCockpit((s) => s.setMapFocused);
  const setShortcutSheetOpen = useCockpit((s) => s.setShortcutSheetOpen);
  const selectedLoopId = useCockpit((s) => s.selectedLoopId);
  const connection = useConnection(selectedLoopId);
  const runStatus = useRunStatus(selectedLoopId);
  const ui = CONNECTION_UI[connection];

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

      {/* Right: live connection + run + org + clock */}
      <div className="flex shrink-0 items-center gap-3">
        <span className="flex items-center gap-1.5" aria-live="polite">
          <StatusDot accent={ui.accent} live={ui.live} size={6} />
          <span className="uppercase tracking-wider text-muted">{ui.label}</span>
          {runStatus === 'running' && (
            <span className="uppercase tracking-wider text-faint">&#183; RUNNING</span>
          )}
          {runStatus === 'paused' && (
            <span className="uppercase tracking-wider text-faint">&#183; PAUSED</span>
          )}
        </span>
        <span className="hidden h-3 w-px bg-hairline sm:block" aria-hidden />
        <span className="hidden truncate text-faint sm:inline">{LOCAL_ORG.name}</span>
        <span className="hidden h-3 w-px bg-hairline sm:block" aria-hidden />
        <LiveClock />
      </div>
    </footer>
  );
}
