'use client';

import { useEffect } from 'react';
import { TABS, useCockpit } from '@/lib/store';

/**
 * The global keyboard layer. ⌘K/⌘P command palette, ⌘D debug logs, ⌘F find,
 * ⌘E explorer/tree, ⌘M map, ? shortcut sheet, 1–6 tabs, [ ] panels, ⌘N/⌘A/⌘T/⌘I
 * quick actions. Single-key chords are ignored while typing in a field.
 */
export function KeyboardChords() {
  useEffect(() => {
    function isTyping(el: EventTarget | null): boolean {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable === true;
    }

    function scrollTo(id: string) {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function onKey(e: KeyboardEvent) {
      const s = useCockpit.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      // ── escape always closes overlays first ──────────────────────────
      if (e.key === 'Escape') {
        if (s.commandOpen) s.setCommandOpen(false);
        if (s.shortcutSheetOpen) s.setShortcutSheetOpen(false);
        return;
      }

      const overlayOpen = s.commandOpen || s.shortcutSheetOpen;

      // ── palette open/toggle/find — allowed even over an overlay ───────
      if (mod && (k === 'k' || k === 'p')) {
        e.preventDefault();
        s.setCommandOpen(!s.commandOpen);
        return;
      }
      if (mod && k === 'f') {
        e.preventDefault();
        s.setCommandOpen(true);
        return;
      }

      // While a modal is open, suppress every other chord so nothing mutates
      // behind it (the overlays have no focus trap in Phase 1 — that lands P5).
      if (overlayOpen) return;

      // ── other modified chords ────────────────────────────────────────
      if (mod) {
        switch (k) {
          case 'd':
            e.preventDefault();
            s.setLogTab('DEBUG');
            scrollTo('log-console');
            return;
          case 'e':
            e.preventDefault();
            s.toggleLeft();
            return;
          case 'm':
            e.preventDefault();
            s.setMapFocused(true);
            scrollTo('activity-map');
            return;
          case 'i':
            // Import Artifact — jump to ARTIFACTS and open the import modal.
            e.preventDefault();
            s.openImport();
            return;
          case 'n':
          case 'a':
          case 't':
            e.preventDefault();
            s.setCommandOpen(true);
            return;
          default:
            return;
        }
      }

      // ── single-key chords (only when not typing) ─────────────────────
      if (isTyping(e.target)) return;

      if (e.key === '?') {
        e.preventDefault();
        s.setShortcutSheetOpen(!s.shortcutSheetOpen);
        return;
      }
      if (e.key === '[') {
        e.preventDefault();
        s.toggleLeft();
        return;
      }
      if (e.key === ']') {
        e.preventDefault();
        s.toggleRight();
        return;
      }
      if (/^[1-6]$/.test(e.key)) {
        const tab = TABS[Number(e.key) - 1];
        if (tab) {
          e.preventDefault();
          s.setTab(tab);
        }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
