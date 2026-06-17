'use client';

import {
  BarChart3,
  Bot,
  FileText,
  KanbanSquare,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { TABS, useCockpit, type Tab } from '@/lib/store';
import { Kbd } from '@/components/atoms';
import { cn } from '@/lib/cn';

/** Tab → its thin-line icon. Order mirrors `TABS`. */
const TAB_ICONS: Record<Tab, LucideIcon> = {
  DASHBOARD: LayoutDashboard,
  AGENTS: Bot,
  TASKS: KanbanSquare,
  ARTIFACTS: FileText,
  ANALYTICS: BarChart3,
  SETTINGS: Settings,
};

/**
 * The six primary tabs. Active tab carries a cyan underline + subtle glow; the rest
 * stay muted until hover. Each tab advertises its 1–6 number shortcut as a Kbd.
 */
export function TabNav() {
  const activeTab = useCockpit((s) => s.activeTab);
  const setTab = useCockpit((s) => s.setTab);

  return (
    <nav className="flex h-full items-stretch" aria-label="Primary">
      {TABS.map((tab, i) => {
        const Icon = TAB_ICONS[tab];
        const active = activeTab === tab;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => setTab(tab)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'focus-ring group relative flex h-full items-center gap-1.5 border-b-2 px-3 transition-colors',
              active
                ? 'border-accent-cyan text-text'
                : 'border-transparent text-muted hover:text-text',
            )}
          >
            <Icon
              className={cn('h-3.5 w-3.5 shrink-0', active && 'text-accent-cyan')}
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="font-mono text-2xs uppercase tracking-wider">{tab}</span>
            <Kbd
              className={cn(
                'ml-0.5 hidden md:inline-flex',
                active && 'border-hairline-strong text-text',
              )}
            >
              {i + 1}
            </Kbd>
            {active && (
              <span
                className="pointer-events-none absolute inset-x-0 -bottom-px h-px"
                style={{ boxShadow: 'var(--glow-cyan)' }}
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
