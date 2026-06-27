'use client';

import { create } from 'zustand';

/**
 * A minimal toast bus — the cockpit's honest feedback channel. Replaces silently-swallowed
 * fetch failures (run / cadence edits / loop create) with a visible success/error line, so
 * an action that didn't take never looks like it did.
 */
export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = `t-${(counter += 1)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
    const ttl = kind === 'error' ? 6000 : 3500;
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ttl);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper for non-component callers (stores, fetch handlers). */
export const toast = {
  success: (m: string) => useToasts.getState().push('success', m),
  error: (m: string) => useToasts.getState().push('error', m),
  info: (m: string) => useToasts.getState().push('info', m),
};
