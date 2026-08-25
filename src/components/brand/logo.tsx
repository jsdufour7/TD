import { cn } from '@/lib/ui';

/**
 * TwoDots — AI Core brand mark, recreated as inline SVG.
 *
 * The official raster logos were supplied as PNG attachments. Because those
 * binaries were not materialised into this sandbox, this component rebuilds the
 * mark as a vector so it scales crisply and adapts to the theme:
 *   - a coral dot top-right,
 *   - a blue-gradient dot bottom-left,
 *   - a smooth "S" ribbon (currentColor) joining them.
 *
 * To use the exact official PNGs instead, drop them into `public/brand/` under
 * the names listed in BRAND_ASSETS and render <BrandImage> — the app's layout and
 * login already fall back to this vector mark when the rasters are absent.
 */

export const BRAND_ASSETS = {
  primary: '/brand/twodots-ai-core-logo-primary-transparent.png',
  monochrome: '/brand/twodots-ai-core-logo-monochrome-transparent.png',
  reversed: '/brand/twodots-ai-core-logo-reversed-transparent.png',
  white: '/brand/twodots-ai-core-logo-white-transparent.png',
  signatureFr: '/brand/twodots-ai-core-logo-signature-fr-transparent.png',
} as const;

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="td-blue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#35A2FF" />
          <stop offset="1" stopColor="#0B63F5" />
        </linearGradient>
      </defs>

      {/* Ribbon: smooth S joining the two dots. */}
      <path
        d="M61 25 C59 38 35 34 34 47 C33 60 57 57 56 67 C55 76 42 78 36 74"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
      />

      {/* Coral dot, top-right. */}
      <circle cx="73" cy="16" r="15" fill="#F2735C" />
      {/* Blue dot, bottom-left. */}
      <circle cx="22" cy="80" r="15" fill="url(#td-blue)" />
    </svg>
  );
}

/** Horizontal lock-up: mark + "TwoDots | AI Core". */
export function Logo({
  className,
  tagline,
}: {
  className?: string;
  tagline?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <LogoMark className="size-9 shrink-0 text-current" />
      <div className="flex items-baseline gap-2 leading-none">
        <span className="text-xl font-semibold tracking-tight text-ink-1">TwoDots</span>
        <span className="h-5 w-px self-center bg-line-strong" aria-hidden="true" />
        <span className="text-xl font-semibold tracking-tight">
          <span className="text-accent">AI</span>
          <span className="text-ink-1"> Core</span>
        </span>
      </div>
      {tagline ? <span className="ml-1 text-xs text-ink-3">{tagline}</span> : null}
    </div>
  );
}
