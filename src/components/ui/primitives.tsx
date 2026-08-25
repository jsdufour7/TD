import { cn } from '@/lib/ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'xs' | 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink hover:bg-accent/90 active:scale-[0.98] disabled:bg-accent/40 font-medium shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(0_0_0/0.3)]',
  secondary: 'bg-surface-3 text-ink-1 hover:bg-surface-3/70 active:scale-[0.98] border border-line shadow-card',
  ghost: 'text-ink-2 hover:text-ink-1 hover:bg-surface-2 active:scale-[0.98]',
  danger: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 active:scale-[0.98]',
  outline: 'border border-line-strong text-ink-1 hover:bg-surface-2 active:scale-[0.98]',
};

const SIZES: Record<Size, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1',
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'sm',
  className,
  children,
  loading,
  // Destructured explicitly so the computed values below cannot be clobbered by
  // the rest-spread, and so `type` has a safe default: a bare <button> inside a
  // form defaults to type="submit" and would silently submit the wrong form.
  type = 'button',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Spinner className="size-3" /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('size-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({
  children,
  className,
  title,
  description,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface-1 shadow-card', className)}>
      {title ? (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-medium text-ink-1">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-ink-3">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const TONES: Record<string, string> = {
  accent: 'bg-accent/15 text-accent border-accent/25',
  ok: 'bg-ok/15 text-ok border-ok/25',
  warn: 'bg-warn/15 text-warn border-warn/25',
  danger: 'bg-danger/15 text-danger border-danger/25',
  info: 'bg-info/15 text-info border-info/25',
  idle: 'bg-surface-3 text-ink-3 border-line-strong',
};

export function Badge({
  children,
  tone = 'idle',
  className,
  dot,
}: {
  children: ReactNode;
  tone?: string;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase',
        TONES[tone] ?? TONES.idle,
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current animate-pulse-dot" /> : null}
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-md border border-dashed border-line bg-surface-1/40 text-center bg-grid',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-12',
      )}
    >
      {icon ? <div className="text-ink-4">{icon}</div> : null}
      <p className={cn('font-medium text-ink-2', compact ? 'text-xs' : 'text-sm')}>{title}</p>
      {description ? (
        <p className={cn('max-w-md text-ink-3', compact ? 'text-[11px]' : 'text-xs')}>{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-danger/30 bg-danger/8 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-danger" />
        <p className="text-xs font-medium text-danger">Something went wrong</p>
      </div>
      <p className="text-xs text-ink-2">{message}</p>
      {onRetry ? (
        <Button size="xs" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-surface-3', className)} />;
}

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1 text-xs font-medium text-ink-2">
        {label}
        {required ? <span className="text-danger">*</span> : null}
      </span>
      {children}
      {hint ? <span className="block text-[11px] text-ink-4">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink-1 placeholder:text-ink-4 transition-[border-color,box-shadow] focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none';

/**
 * Tone → class. Written out in full on purpose: Tailwind only generates classes
 * it can see as complete literals, so `text-${tone}` would produce nothing.
 */
const TONE_TEXT: Record<string, string> = {
  accent: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  idle: 'text-ink-3',
};

export function toneTextClass(tone?: string): string {
  return TONE_TEXT[tone ?? ''] ?? 'text-ink-1';
}

export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-4 py-3">
      <p className="text-[11px] tracking-wide text-ink-3 uppercase">{label}</p>
      <p className={cn('mt-1 font-mono text-2xl leading-none tabular-nums', toneTextClass(tone))}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-ink-4">{hint}</p> : null}
    </div>
  );
}
