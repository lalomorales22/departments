'use client';

import { Check, X, AlertTriangle, Info } from 'lucide-react';
import { useToasts, type ToastKind } from '@/lib/toast';
import { accentVar } from '@/lib/status-theme';
import type { AccentKey } from '@departments/shared';

const KIND: Record<ToastKind, { accent: AccentKey; Icon: typeof Check }> = {
  success: { accent: 'green', Icon: Check },
  error: { accent: 'red', Icon: AlertTriangle },
  info: { accent: 'cyan', Icon: Info },
};

/** Bottom-right toast stack. Calm by default; color only carries the success/error signal. */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-rail right-3 z-50 flex flex-col gap-1.5" aria-live="polite">
      {toasts.map((t) => {
        const { accent, Icon } = KIND[t.kind];
        const color = accentVar(accent);
        return (
          <div
            key={t.id}
            className="panel pointer-events-auto flex items-center gap-2 px-2.5 py-1.5 text-xs shadow-lg animate-fade-in"
            style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)` }}
            role="status"
          >
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
            <span className="text-text">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="focus-ring ml-1 shrink-0 rounded-sm p-0.5 text-faint hover:text-text"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
