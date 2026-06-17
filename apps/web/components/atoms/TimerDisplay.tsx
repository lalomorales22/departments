'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

function fmt(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Elapsed-time readout that ticks forward each second while `running`. */
export function TimerDisplay({
  startSeconds,
  running = true,
  className,
}: {
  startSeconds: number;
  running?: boolean;
  className?: string;
}) {
  const [secs, setSecs] = useState(startSeconds);

  useEffect(() => setSecs(startSeconds), [startSeconds]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  return (
    <span className={cn('tabular', className)} suppressHydrationWarning>
      {fmt(secs)}
    </span>
  );
}
