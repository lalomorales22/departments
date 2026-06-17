import { cn } from '@/lib/cn';

/** A faint, low-emphasis tag (task tags, area chips). */
export function TagChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-hairline bg-surface-2 px-1.5 py-px font-mono text-2xs text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}
