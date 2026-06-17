'use client';

import { Shield } from 'lucide-react';
import { COMMANDER } from '@/lib/fixtures';

/**
 * Pinned-bottom identity row: a square initials avatar with an accent ring, the
 * commander's name, the COMMANDER role eyebrow, and a Shield glyph (holds the kill
 * switch). Sits above a hairline top divider.
 */
export function CommanderProfile() {
  return (
    <div className="flex items-center gap-2.5 border-t border-hairline px-3 py-2.5">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-2 font-mono text-2xs tabular text-accent-cyan"
        style={{ boxShadow: '0 0 0 1px color-mix(in oklab, var(--accent-cyan) 38%, transparent)' }}
      >
        {COMMANDER.initials}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm leading-none text-text">Commander</span>
        <span className="eyebrow leading-none">{COMMANDER.role}</span>
      </div>
      <Shield className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.5} aria-hidden />
    </div>
  );
}
