'use client';

import { Search } from 'lucide-react';
import { useCockpit } from '@/lib/store';
import { Kbd } from '@/components/atoms';
import { TabNav } from './TabNav';
import { TransportBar } from './TransportBar';

/**
 * The top bar: wordmark + mission-control tag, the primary tab nav, a command-search
 * pill (⌘K → palette), and the transport cluster.
 */
export function AppBar() {
  const setCommandOpen = useCockpit((s) => s.setCommandOpen);

  return (
    <header className="flex h-12 items-center justify-between gap-4 border-b border-hairline bg-bg px-3">
      {/* Left: wordmark */}
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-accent-cyan text-sm leading-none" aria-hidden>
            &#9672;
          </span>
          <span className="text-sm font-semibold tracking-wide text-text">DEPARTMENTS</span>
        </div>
        <span className="eyebrow hidden rounded-sm border border-hairline bg-surface-2 px-1.5 py-0.5 leading-none sm:inline-block">
          MISSION CONTROL
        </span>
      </div>

      {/* Center-left: tabs */}
      <div className="flex min-w-0 flex-1 items-stretch self-stretch overflow-x-auto">
        <TabNav />
      </div>

      {/* Right: search + transport */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          aria-label="Search loops, agents, commands"
          className="focus-ring panel-inset group flex h-7 items-center gap-2 px-2 text-muted transition-colors hover:border-hairline-strong"
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.75} aria-hidden />
          <span className="hidden font-mono text-2xs text-faint lg:inline">
            Search loops, agents, commands&#8230;
          </span>
          <Kbd className="ml-1">&#8984;K</Kbd>
        </button>
        <TransportBar />
      </div>
    </header>
  );
}
