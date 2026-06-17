'use client';

import { type LucideIcon, ListPlus, Plus, Search, Upload, UserPlus } from 'lucide-react';
import { Kbd, SectionLabel } from '@/components/atoms';
import { useCockpit } from '@/lib/store';

interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut: string;
}

/** Every quick action routes through the command palette — the single entry point. */
const ACTIONS: QuickAction[] = [
  { id: 'new-loop', label: 'New Loop', icon: Plus, shortcut: '⌘N' },
  { id: 'new-agent', label: 'New Agent', icon: UserPlus, shortcut: '⌘A' },
  { id: 'new-task', label: 'New Task', icon: ListPlus, shortcut: '⌘T' },
  { id: 'import-artifact', label: 'Import Artifact', icon: Upload, shortcut: '⌘I' },
  { id: 'global-search', label: 'Global Search', icon: Search, shortcut: '⌘K' },
];

/**
 * Quick-action launcher list. Each row opens the command palette (the canonical entry
 * point for every creation/search flow in Phase 1).
 */
export function QuickActionList() {
  const setCommandOpen = useCockpit((s) => s.setCommandOpen);

  return (
    <div className="px-3 py-3">
      <SectionLabel className="mb-1.5">Quick Actions</SectionLabel>
      <ul className="flex flex-col gap-px">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <li key={action.id}>
              <button
                type="button"
                onClick={() => setCommandOpen(true)}
                className="group flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-muted transition-colors hover:bg-surface-2 hover:text-text focus-ring"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-faint group-hover:text-text" strokeWidth={1.5} />
                <span className="flex-1 text-sm leading-none">{action.label}</span>
                <Kbd className="shrink-0">{action.shortcut}</Kbd>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
