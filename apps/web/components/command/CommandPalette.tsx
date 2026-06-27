'use client';

import { useCallback, useEffect } from 'react';
import { Command } from 'cmdk';
import {
  FileDown,
  Play,
  Plus,
  Search,
  UserPlus,
  ListPlus,
  type LucideIcon,
} from 'lucide-react';
import { TABS, useCockpit, type Tab } from '@/lib/store';
import { useLoops } from '@/lib/loops-client';
import { StatusDot } from '@/components/atoms';
import { loopStatusAccent, isLiveLoopStatus } from '@/lib/status-theme';

/** Tab → icon for the NAVIGATE group (kept local; mirrors TabNav). */
const NAV_ICONS: Record<Tab, LucideIcon> = {
  DASHBOARD: Search,
  AGENTS: UserPlus,
  TASKS: ListPlus,
  ARTIFACTS: FileDown,
  ANALYTICS: Play,
  SETTINGS: Plus,
};

/** Shared item shell: hover/selected → surface-2 + a cyan left accent bar. */
function PaletteItem({
  value,
  onSelect,
  icon: Icon,
  children,
  trailing,
}: {
  value: string;
  onSelect: () => void;
  icon?: LucideIcon;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="group relative flex cursor-pointer items-center gap-2.5 rounded-sm border-l-2 border-transparent px-2.5 py-2 text-sm text-muted transition-colors data-[selected=true]:border-accent-cyan data-[selected=true]:bg-surface-2 data-[selected=true]:text-text"
    >
      {Icon && (
        <Icon
          className="h-3.5 w-3.5 shrink-0 text-faint transition-colors group-data-[selected=true]:text-accent-cyan"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing != null && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
    </Command.Item>
  );
}

/** Uppercase tracked group heading rendered by cmdk. */
const GROUP_CLASS = '[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3';

/**
 * The command palette: a centered cmdk modal over a dark backdrop. Groups: RUN LOOP
 * (every loop, → select), NAVIGATE (the six tabs), and ACTIONS (visual stubs). Esc or
 * a backdrop click closes. Styled entirely with our tokens — no default cmdk theme.
 */
export function CommandPalette() {
  const LOOPS = useLoops();
  const open = useCockpit((s) => s.commandOpen);
  const setCommandOpen = useCockpit((s) => s.setCommandOpen);
  const setSelectedLoop = useCockpit((s) => s.setSelectedLoop);
  const setTab = useCockpit((s) => s.setTab);
  const openImport = useCockpit((s) => s.openImport);

  const close = useCallback(() => setCommandOpen(false), [setCommandOpen]);

  // Esc closes even when focus is inside the cmdk input.
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      onMouseDown={close}
      role="presentation"
    >
      <div
        className="panel w-full max-w-xl animate-fade-in overflow-hidden shadow-elevation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Command
          loop
          label="Command palette"
          className="flex max-h-[60vh] flex-col"
        >
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-hairline px-3">
            <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.75} aria-hidden />
            <Command.Input
              autoFocus
              placeholder="Search loops, agents, commands&#8230;"
              className="h-11 w-full bg-transparent text-sm text-text placeholder:text-faint focus:outline-none"
            />
          </div>

          <Command.List className="flex-1 overflow-y-auto px-1.5 pb-2">
            <Command.Empty className="px-2.5 py-6 text-center font-mono text-2xs text-faint">
              No matches.
            </Command.Empty>

            <Command.Group heading="RUN LOOP" className={GROUP_CLASS}>
              {LOOPS.map((loop) => (
                <PaletteItem
                  key={loop.id}
                  value={`run ${loop.name} ${loop.displayName}`}
                  icon={Play}
                  onSelect={() => {
                    setSelectedLoop(loop.id);
                    close();
                  }}
                  trailing={
                    <StatusDot
                      accent={loopStatusAccent[loop.status]}
                      live={isLiveLoopStatus(loop.status)}
                      size={6}
                    />
                  }
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{loop.name}</span>
                    <span className="font-mono text-2xs text-faint">L{loop.level}</span>
                  </span>
                </PaletteItem>
              ))}
            </Command.Group>

            <Command.Group heading="NAVIGATE" className={GROUP_CLASS}>
              {TABS.map((tab) => {
                const Icon = NAV_ICONS[tab];
                return (
                  <PaletteItem
                    key={tab}
                    value={`go ${tab}`}
                    icon={Icon}
                    onSelect={() => {
                      setTab(tab);
                      close();
                    }}
                  >
                    <span className="font-mono uppercase tracking-wide">{tab}</span>
                  </PaletteItem>
                );
              })}
            </Command.Group>

            <Command.Group heading="ACTIONS" className={GROUP_CLASS}>
              <PaletteItem value="new loop" icon={Plus} onSelect={close}>
                New Loop
              </PaletteItem>
              <PaletteItem value="new agent" icon={UserPlus} onSelect={close}>
                New Agent
              </PaletteItem>
              <PaletteItem value="new task" icon={ListPlus} onSelect={close}>
                New Task
              </PaletteItem>
              <PaletteItem value="import artifact" icon={FileDown} onSelect={openImport}>
                Import Artifact
              </PaletteItem>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
