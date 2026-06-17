'use client';

import type { AccentKey } from '@departments/shared';
import { accentVar, glowVar } from '@/lib/status-theme';
import { cn } from '@/lib/cn';

/** Pick a semantic accent from a 0–100 health value (calm→hot as it drops). */
function accentForValue(value: number): AccentKey {
  if (value >= 90) return 'green';
  if (value >= 75) return 'cyan';
  if (value >= 50) return 'amber';
  return 'red';
}

/**
 * Compact circular ring gauge. The filled arc spans `value/100` of the ring; the
 * remainder is the inset track. Color resolves through `accentVar` (chosen by value
 * unless overridden). The center % glows subtly only when health is high.
 */
export function HealthGauge({
  value,
  accent,
  size = 56,
  className,
}: {
  value: number;
  accent?: AccentKey;
  size?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const key = accent ?? accentForValue(clamped);
  const color = accentVar(key);

  const strokeWidth = 4;
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (clamped / 100) * circumference;

  const high = clamped >= 90;

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        {/* track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={strokeWidth}
        />
        {/* filled arc */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filled.toFixed(2)} ${circumference.toFixed(2)}`}
          style={{ transition: 'stroke-dasharray 0.4s ease-out' }}
        />
      </svg>
      <span
        className="tabular absolute inset-0 flex items-center justify-center text-lg font-semibold leading-none"
        style={{ color, textShadow: high ? glowVar(key) : 'none' }}
        data-machine
      >
        {Math.round(clamped)}
      </span>
    </div>
  );
}
