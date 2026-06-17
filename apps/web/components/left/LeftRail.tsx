'use client';

import { CommandBar } from './CommandBar';
import { CommanderProfile } from './CommanderProfile';
import { LoopTree } from './LoopTree';
import { QuickActionList } from './QuickActionList';

/**
 * The full left column. Fills the height of the fixed-width column the AppShell
 * provides (does NOT set its own width). Command bar up top, the scrollable loop
 * hierarchy taking the flexible middle, quick actions, then the commander profile
 * pinned to the bottom. Sections separated by hairline dividers.
 */
export function LeftRail() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-hairline p-2.5">
        <CommandBar />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden border-b border-hairline">
        <LoopTree />
      </div>

      <div className="border-b border-hairline">
        <QuickActionList />
      </div>

      <CommanderProfile />
    </div>
  );
}
