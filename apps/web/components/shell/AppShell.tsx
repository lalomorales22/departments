'use client';

import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCockpit } from '@/lib/store';
import { useRealtime } from '@/lib/realtime';
import { cn } from '@/lib/cn';
import { AppBar } from './AppBar';
import { StatusBar } from './StatusBar';
import { LeftRail } from '../left/LeftRail';
import { CenterColumn } from '../center/CenterColumn';
import { InspectorPanel } from '../right/InspectorPanel';
import { CommandPalette } from '../command/CommandPalette';
import { ShortcutSheet } from '../command/ShortcutSheet';
import { KeyboardChords } from '../command/KeyboardChords';

/**
 * The cockpit frame: AppBar over a 3-column body (collapsible left/right) over the
 * StatusBar, plus the global command/keyboard layer. Center + inspector bind to the
 * selected loop.
 */
export function AppShell() {
  const { selectedLoopId, leftCollapsed, rightCollapsed, toggleLeft, toggleRight } = useCockpit();

  // Keep ONE live SSE subscription open for the selected loop (reconnect-safe; resumes
  // by seq). Switching loops tears down the prior subscription and opens the new one.
  useEffect(() => {
    const rt = useRealtime.getState();
    rt.connect(selectedLoopId);
    return () => rt.disconnect(selectedLoopId);
  }, [selectedLoopId]);

  // Deep-link auto-run: `?run` (optionally `?run=<loopId>`) kicks off one real cycle
  // on load — handy for demos, deep links, and headless verification.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('run')) return;
    const target = params.get('run') || useCockpit.getState().selectedLoopId;
    useCockpit.getState().setSelectedLoop(target);
    void useRealtime.getState().runLoop(target);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-text">
      <AppBar />

      <div className="flex min-h-0 flex-1">
        {/* LEFT */}
        <aside
          className={cn(
            'shrink-0 overflow-hidden border-r border-hairline bg-bg transition-[width] duration-200 ease-out',
            leftCollapsed ? 'w-9' : 'w-[264px]',
          )}
        >
          {leftCollapsed ? (
            <CollapsedStrip side="left" onExpand={toggleLeft} label="EXPLORER" />
          ) : (
            <LeftRail />
          )}
        </aside>

        {/* CENTER */}
        <main id="main" className="min-w-0 flex-1 overflow-y-auto">
          <CenterColumn loopId={selectedLoopId} />
        </main>

        {/* RIGHT */}
        <aside
          className={cn(
            'shrink-0 overflow-hidden border-l border-hairline bg-bg transition-[width] duration-200 ease-out',
            rightCollapsed ? 'w-9' : 'w-[344px]',
          )}
        >
          {rightCollapsed ? (
            <CollapsedStrip side="right" onExpand={toggleRight} label="INSPECTOR" />
          ) : (
            <InspectorPanel loopId={selectedLoopId} />
          )}
        </aside>
      </div>

      <StatusBar />

      {/* overlays + global keyboard layer */}
      <CommandPalette />
      <ShortcutSheet />
      <KeyboardChords />
    </div>
  );
}

function CollapsedStrip({
  side,
  onExpand,
  label,
}: {
  side: 'left' | 'right';
  onExpand: () => void;
  label: string;
}) {
  const Icon = side === 'left' ? ChevronRight : ChevronLeft;
  return (
    <div className="flex h-full flex-col items-center gap-3 py-3">
      <button
        type="button"
        onClick={onExpand}
        className="focus-ring rounded-sm border border-hairline bg-surface-2 p-1 text-muted hover:text-text"
        aria-label={`Expand ${label.toLowerCase()} panel`}
        title={`Expand ${label.toLowerCase()} panel`}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
      <span
        className="eyebrow whitespace-nowrap"
        style={{ writingMode: 'vertical-rl', transform: side === 'left' ? 'none' : 'rotate(180deg)' }}
      >
        {label}
      </span>
    </div>
  );
}
