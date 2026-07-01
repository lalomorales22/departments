'use client';

import { useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCockpit } from '@/lib/store';
import { useRealtime } from '@/lib/realtime';
import { useLoopRegistry } from '@/lib/loops-client';
import { cn } from '@/lib/cn';
import { AppBar } from './AppBar';
import { StatusBar } from './StatusBar';
import { LeftRail } from '../left/LeftRail';
import { CenterColumn } from '../center/CenterColumn';
import { InspectorPanel } from '../right/InspectorPanel';
import { CommandPalette } from '../command/CommandPalette';
import { CreationModals } from '../command/CreationModals';
import { ShortcutSheet } from '../command/ShortcutSheet';
import { KeyboardChords } from '../command/KeyboardChords';
import { Toaster } from './Toaster';

/**
 * The cockpit frame: AppBar over a 3-column body (collapsible left/right) over the
 * StatusBar, plus the global command/keyboard layer. Center + inspector bind to the
 * selected loop.
 */
export function AppShell() {
  const { selectedLoopId, leftCollapsed, rightCollapsed, toggleLeft, toggleRight, rightWidth } =
    useCockpit();

  // Load the real loop registry once, then make sure a valid loop is selected (the first
  // one, unless a persisted selection is still present).
  useEffect(() => {
    void useLoopRegistry.getState().hydrate().then(() => {
      const { loops } = useLoopRegistry.getState();
      const { selectedLoopId: sel, setSelectedLoop } = useCockpit.getState();
      if (!sel || !loops.some((l) => l.id === sel)) setSelectedLoop(loops[0]?.id ?? '');
    });
  }, []);

  // Keep ONE live SSE subscription open for the selected loop (reconnect-safe; resumes
  // by seq). Switching loops tears down the prior subscription and opens the new one.
  useEffect(() => {
    if (!selectedLoopId) return;
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
    if (target) useCockpit.getState().enterLoop(target);
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

        {/* RIGHT — drag handle + resizable/collapsible inspector */}
        {!rightCollapsed && <ResizeHandle />}
        <aside
          className={cn(
            'shrink-0 overflow-hidden border-l border-hairline bg-bg',
            rightCollapsed && 'w-9 transition-[width] duration-200 ease-out',
          )}
          style={rightCollapsed ? undefined : { width: rightWidth }}
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
      <CreationModals />
      <ShortcutSheet />
      <KeyboardChords />
      <Toaster />
    </div>
  );
}

/**
 * A thin drag rail between the center and the inspector. Dragging resizes the inspector
 * (width = viewport − pointerX, clamped in the store); double-click collapses it.
 */
function ResizeHandle() {
  const setRightWidth = useCockpit((s) => s.setRightWidth);
  const toggleRight = useCockpit((s) => s.toggleRight);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => setRightWidth(window.innerWidth - ev.clientX);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [setRightWidth],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize inspector"
      onPointerDown={onPointerDown}
      onDoubleClick={toggleRight}
      className="group relative w-1 shrink-0 cursor-col-resize bg-hairline transition-colors hover:bg-accent-cyan/60"
      title="Drag to resize · double-click to collapse"
    >
      {/* widen the hit target without taking layout space */}
      <span className="absolute inset-y-0 -left-1 -right-1" aria-hidden />
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
