import type { AccentKey } from '@departments/shared';
import { accentVar, glowVar } from '@/lib/status-theme';
import { cn } from '@/lib/cn';

/**
 * A small state dot. `live` adds the pulse + glow (glow is reserved for live/selected
 * surfaces per the design ethos). Color always resolves through `accentVar`.
 */
export function StatusDot({
  accent,
  live = false,
  size = 7,
  className,
}: {
  accent: AccentKey;
  live?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-block shrink-0 rounded-full', live && 'animate-pulse-dot', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: accentVar(accent),
        boxShadow: live ? glowVar(accent) : 'none',
      }}
      aria-hidden
    />
  );
}
