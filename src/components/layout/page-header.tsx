import type { ReactNode } from 'react';
import { cn } from '@/lib/ui';

/**
 * Page header (§26).
 *
 * One consistent rhythm across every surface: title, one-line intent, optional
 * live meta, actions on the right. Pages never invent their own heading styles.
 */
export function PageHeader({
  title,
  subtitle,
  action,
  breadcrumb,
  icon,
  meta,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  breadcrumb?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface-1 text-accent shadow-card">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          {breadcrumb ? <div className="mb-1">{breadcrumb}</div> : null}
          <h1 className="truncate text-[19px] leading-tight font-semibold tracking-tight text-ink-1">{title}</h1>
          {subtitle ? <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-3">{subtitle}</p> : null}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  );
}

/** Small breadcrumb link row used above project sub-pages. */
export function Breadcrumb({ items }: { items: Array<{ href?: string; label: string }> }) {
  return (
    <nav aria-label="Fil d’Ariane" className="flex items-center gap-1.5 text-[11px] text-ink-4">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1.5">
          {item.href ? (
            <a href={item.href} className="transition-colors hover:text-ink-1">
              {item.label}
            </a>
          ) : (
            <span className="text-ink-2">{item.label}</span>
          )}
          {index < items.length - 1 ? <span aria-hidden="true">/</span> : null}
        </span>
      ))}
    </nav>
  );
}
