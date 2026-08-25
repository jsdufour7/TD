import { cn } from '@/lib/ui';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * The component system (§38).
 *
 * Every surface in the product is built from these primitives so spacing,
 * radius, focus and elevation stay consistent without a page ever inventing its
 * own. Variants are closed sets on purpose: the design language is a decision,
 * not a suggestion.
 */

/* ------------------------------------------------------------------ Button */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'subtle';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent shadow-[0_1px_2px_rgb(0_0_0/0.35)] font-medium',
  secondary: 'bg-surface-2 text-ink-1 hover:bg-surface-3 border border-line hover:border-line-strong',
  ghost: 'text-ink-3 hover:text-ink-1 hover:bg-surface-2',
  subtle: 'bg-accent-soft text-accent hover:bg-accent/20',
  danger: 'bg-danger/12 text-danger border border-danger/30 hover:bg-danger/20',
  outline: 'border border-line-strong text-ink-1 hover:bg-surface-2 hover:border-ink-4/40',
};

const SIZES: Record<Size, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded-sm',
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-4 text-[13px] gap-2 rounded-md',
  lg: 'h-11 px-5 text-sm gap-2 rounded-lg',
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
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[background-color,border-color,color,transform,box-shadow] duration-150',
        'active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  );
}

/** Square icon-only button with a mandatory accessible label. */
export function IconButton({
  label,
  className,
  variant = 'ghost',
  size = 'sm',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: Variant; size?: Size }) {
  const dims = size === 'xs' ? 'size-6' : size === 'md' ? 'size-9' : size === 'lg' ? 'size-11' : 'size-8';
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      aria-label={label}
      title={label}
      className={cn(
        'inline-grid place-items-center rounded-md transition-colors duration-150 active:scale-[0.94] disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        dims,
        className,
      )}
    >
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

/* -------------------------------------------------------------------- Card */

export function Card({
  children,
  className,
  title,
  description,
  action,
  footer,
  padded = false,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  /** Adds inner padding for simple content cards. */
  padded?: boolean;
  hover?: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-lg border border-line bg-surface-1 shadow-card edge-top',
        hover && 'transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-lift',
        className,
      )}
    >
      {title ? (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-ink-1">{title}</h2>
            {description ? <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{description}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </header>
      ) : null}
      <div className={padded ? 'p-4' : undefined}>{children}</div>
      {footer ? <footer className="border-t border-line px-4 py-2.5">{footer}</footer> : null}
    </section>
  );
}

/* ------------------------------------------------------------------- Badge */

const TONES: Record<string, string> = {
  accent: 'bg-accent/14 text-accent border-accent/28',
  ok: 'bg-ok/14 text-ok border-ok/28',
  warn: 'bg-warn/14 text-warn border-warn/28',
  danger: 'bg-danger/14 text-danger border-danger/28',
  info: 'bg-info/14 text-info border-info/28',
  idle: 'bg-surface-2 text-ink-3 border-line-strong',
};

export function Badge({
  children,
  tone = 'idle',
  className,
  dot,
  title,
}: {
  children: ReactNode;
  tone?: string;
  className?: string;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase',
        TONES[tone] ?? TONES.idle,
        className,
      )}
    >
      {dot ? <span className="size-1.5 animate-pulse-dot rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-md border border-dashed border-line bg-surface-1/40 bg-grid text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-12',
        className,
      )}
    >
      {icon ? (
        <div className={cn('grid place-items-center rounded-full border border-line bg-surface-1 text-ink-4', compact ? 'size-8' : 'size-11')}>
          {icon}
        </div>
      ) : null}
      <p className={cn('font-medium text-ink-2', compact ? 'text-xs' : 'text-sm')}>{title}</p>
      {description ? <p className={cn('max-w-md text-ink-3', compact ? 'text-[11px]' : 'text-xs')}>{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry, title }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-danger/30 bg-danger/8 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-danger" />
        <p className="text-xs font-medium text-danger">{title ?? 'Something went wrong'}</p>
      </div>
      <p className="text-xs leading-relaxed text-ink-2">{message}</p>
      {onRetry ? (
        <Button size="xs" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/** Inline warning/note strip used for honest degradations. */
export function Notice({
  tone = 'warn',
  title,
  children,
  action,
  className,
}: {
  tone?: 'warn' | 'info' | 'danger' | 'ok';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const palette = {
    warn: 'border-warn/30 bg-warn/8 text-warn',
    info: 'border-info/30 bg-info/8 text-info',
    danger: 'border-danger/30 bg-danger/8 text-danger',
    ok: 'border-ok/30 bg-ok/8 text-ok',
  }[tone];
  return (
    <div className={cn('flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-md border px-3 py-2.5', palette, className)}>
      <div className="min-w-0 flex-1">
        {title ? <p className="text-xs font-semibold">{title}</p> : null}
        {children ? <div className={cn('text-[11.5px] leading-relaxed text-ink-2', title && 'mt-0.5')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------- Skeletons */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-shimmer rounded bg-surface-2', className)} />;
}

/* ------------------------------------------------------------------ Inputs */

export const inputClass =
  'w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-1 placeholder:text-ink-4 transition-[border-color,box-shadow] focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none disabled:opacity-50';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputClass, 'resize-y', className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={cn(inputClass, 'appearance-none pr-8', className)}>
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  required,
  error,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
  error?: string;
  className?: string;
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="flex items-center gap-1 text-xs font-medium text-ink-2">
        {label}
        {required ? <span className="text-danger">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="block text-[11px] text-danger">{error}</span>
      ) : hint ? (
        <span className="block text-[11px] leading-relaxed text-ink-4">{hint}</span>
      ) : null}
    </label>
  );
}

/** Compact labelled control used in dense toolbars and drawers. */
export function MiniField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="block text-[10px] font-medium tracking-wide text-ink-4 uppercase">{label}</span>
      {children}
    </label>
  );
}

/** Accessible on/off switch. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-45',
        checked ? 'border-accent/40 bg-accent/70' : 'border-line-strong bg-surface-3',
      )}
    >
      <span
        className={cn(
          'absolute size-3.5 rounded-full bg-ink-1 shadow transition-transform duration-200',
          checked ? 'translate-x-[1.15rem]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

/* -------------------------------------------------------------------- Tabs */

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string; count?: number }>;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('flex items-center gap-1 rounded-md border border-line bg-surface-1 p-1', className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors duration-150',
              active ? 'bg-surface-3 text-ink-1 shadow-card' : 'text-ink-3 hover:bg-surface-2 hover:text-ink-1',
            )}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className={cn('font-mono text-[10px] tabular-nums', active ? 'text-accent' : 'text-ink-4')}>{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ Modal / Sheet */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Fermer" className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" onClick={onClose} />
      <div className={cn('animate-pop relative w-full rounded-xl border border-line-strong bg-surface-1 shadow-pop', width)}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink-1">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-ink-3">{description}</p> : null}
          </div>
          <IconButton label="Fermer" onClick={onClose}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </IconButton>
        </header>
        <div className="max-h-[62vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Misc */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-2 px-1.5 font-mono text-[10px] text-ink-3 shadow-[inset_0_-1px_0_rgb(0_0_0/0.25)]">
      {children}
    </kbd>
  );
}

export function Progress({ value, tone = 'accent', className }: { value: number; tone?: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const bar = {
    accent: 'bg-accent',
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
    info: 'bg-info',
  }[tone] ?? 'bg-accent';
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dims = size === 'sm' ? 'size-6 text-[10px]' : size === 'lg' ? 'size-10 text-sm' : 'size-7 text-[11px]';
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full border border-line-strong bg-surface-2 font-mono font-medium text-ink-2',
        dims,
        className,
      )}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-[10px] font-semibold tracking-[0.08em] text-ink-4 uppercase', className)}>{children}</p>
  );
}

const TONE_TEXT: Record<string, string> = {
  accent: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  idle: 'text-ink-3',
};

/**
 * Tone → class. Written out in full on purpose: Tailwind only generates classes
 * it can see as complete literals, so `text-${tone}` would produce nothing.
 */
export function toneTextClass(tone?: string): string {
  return TONE_TEXT[tone ?? ''] ?? 'text-ink-1';
}

export function Stat({
  label,
  value,
  tone,
  hint,
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
  hint?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface-1 px-4 py-3 shadow-card edge-top', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10.5px] font-medium tracking-wide text-ink-3 uppercase">{label}</p>
        {icon ? <span className="text-ink-4">{icon}</span> : null}
      </div>
      <p className={cn('mt-1.5 font-mono text-2xl leading-none tabular-nums', toneTextClass(tone))}>{value}</p>
      {hint ? <p className="mt-1.5 truncate text-[11px] text-ink-4">{hint}</p> : null}
    </div>
  );
}
