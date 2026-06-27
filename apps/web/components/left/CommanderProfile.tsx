'use client';

import { useState } from 'react';
import { Shield, ChevronsUpDown, Check } from 'lucide-react';
import { ROLES_BY_SENIORITY, USER_ROLE_LABELS } from '@departments/shared';
import { LOCAL_COMMANDER } from '@/lib/workspace';
import { useCockpit } from '@/lib/store';
import { cn } from '@/lib/cn';

/**
 * Pinned-bottom identity row + the multi-role SWITCHER (Phase 5). The avatar + name come
 * from the session user; the role eyebrow reflects the acting {@link useCockpit} role,
 * and the switcher lets a demo preview each role (Commander/Operator/Viewer/Owner) so the
 * capability gating across the cockpit is visible. In prod the role is the session's; the
 * gateway is authoritative — this only changes which controls the UI offers.
 */
export function CommanderProfile() {
  const userRole = useCockpit((s) => s.userRole);
  const setUserRole = useCockpit((s) => s.setUserRole);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative border-t border-hairline">
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            aria-label="Switch acting role"
            className="absolute bottom-full left-3 right-3 z-20 mb-1 overflow-hidden rounded-sm border border-hairline-strong bg-surface-2 shadow-glow-cyan/0 shadow-lg"
          >
            {ROLES_BY_SENIORITY.map((role) => (
              <li key={role}>
                <button
                  type="button"
                  role="option"
                  aria-selected={role === userRole}
                  onClick={() => {
                    setUserRole(role);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-3 focus-ring',
                    role === userRole ? 'text-accent-cyan' : 'text-muted',
                  )}
                >
                  {USER_ROLE_LABELS[role]}
                  {role === userRole && <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch acting role"
        className="focus-ring flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2/50"
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-2 font-mono text-2xs tabular text-accent-cyan"
          style={{ boxShadow: '0 0 0 1px color-mix(in oklab, var(--accent-cyan) 38%, transparent)' }}
        >
          {LOCAL_COMMANDER.initials}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm leading-none text-text">{LOCAL_COMMANDER.name}</span>
          <span className="eyebrow leading-none">{USER_ROLE_LABELS[userRole]}</span>
        </div>
        {userRole === 'commander' || userRole === 'owner' ? (
          <Shield className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.5} aria-hidden />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={1.5} aria-hidden />
        )}
      </button>
    </div>
  );
}
