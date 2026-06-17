import { cn } from '@/lib/cn';

/** A keycap. Use for shortcut hints (⌘K, ?, [, ]). */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-hairline bg-surface-2 px-1 font-mono text-2xs text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
