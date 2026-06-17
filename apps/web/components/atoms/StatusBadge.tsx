import type { AccentKey } from '@departments/shared';
import { accentVar } from '@/lib/status-theme';
import { cn } from '@/lib/cn';
import { StatusDot } from './StatusDot';

/** Pill: state dot + uppercase mono label, tinted by accent. */
export function StatusBadge({
  accent,
  label,
  live = false,
  className,
}: {
  accent: AccentKey;
  label: string;
  live?: boolean;
  className?: string;
}) {
  const color = accentVar(accent);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wider',
        className,
      )}
      style={{
        color,
        borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
      }}
    >
      <StatusDot accent={accent} live={live} size={6} />
      {label}
    </span>
  );
}
