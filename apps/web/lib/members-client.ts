'use client';

/**
 * The client-side org roster — a reactive mirror of the real, SQLite-backed members served
 * by `/api/org/members`. Starts from just the local commander (seeded server-side); add /
 * delete / role-change all persist. Replaces the Phase-5 hardcoded `MEMBERS` demo array.
 */
import { create } from 'zustand';
import type { User, UserRole } from '@departments/shared';

interface AddMemberInput {
  name: string;
  email: string;
  role: UserRole;
}

interface MembersRegistry {
  members: User[];
  loaded: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  add: (input: AddMemberInput) => Promise<{ ok: boolean; error?: string }>;
  setRole: (id: string, role: UserRole) => Promise<void>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

export const useMembersRegistry = create<MembersRegistry>((set, get) => ({
  members: [],
  loaded: false,
  error: null,

  hydrate: async () => {
    try {
      const res = await fetch('/api/org/members', { cache: 'no-store' });
      const data = (await res.json()) as { members: User[] };
      set({ members: data.members ?? [], loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : 'failed to load members' });
    }
  },

  add: async (input) => {
    try {
      const res = await fetch('/api/org/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json()) as { member?: User; error?: string };
      if (!res.ok || !data.member) return { ok: false, error: data.error ?? 'failed to add member' };
      set((s) => ({ members: [...s.members, data.member as User] }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'failed to add member' };
    }
  },

  setRole: async (id, role) => {
    // Optimistic; re-sync on failure.
    set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, role } : m)) }));
    try {
      const res = await fetch(`/api/org/members/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) await get().hydrate();
    } catch {
      await get().hydrate();
    }
  },

  remove: async (id) => {
    try {
      const res = await fetch(`/api/org/members/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: data.error ?? 'failed to remove member' };
      }
      set((s) => ({ members: s.members.filter((m) => m.id !== id) }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'failed to remove member' };
    }
  },
}));

export function useMembers(): User[] {
  return useMembersRegistry((s) => s.members);
}
