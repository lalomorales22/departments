import { cn } from '@/lib/cn';

/** Panel eyebrow header: uppercase tracked mono label + optional right-aligned node. */
export function SectionLabel({
  children,
  right,
  className,
  icon,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <span className="eyebrow flex items-center gap-1.5">
        {icon}
        {children}
      </span>
      {right != null && <span className="flex items-center gap-1.5">{right}</span>}
    </div>
  );
}
