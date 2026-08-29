import { cn } from '@/lib/ui';

export const BRAND_ASSETS = {
  primary: '/brand/twodots-ai-core-logo-primary-transparent.png',
  monochrome: '/brand/twodots-ai-core-logo-monochrome-transparent.png',
  reversed: '/brand/twodots-ai-core-logo-reversed-transparent.png',
  signatureEn: '/brand/twodots-ai-core-logo-signature-en-transparent.png',
  signatureFr: '/brand/twodots-ai-core-logo-signature-fr-transparent.png',
  poweredBy: '/brand/twodots-ai-core-powered-by-badge.png',
  propulsePar: '/brand/twodots-ai-core-propulse-par-badge.png',
} as const;

/**
 * Exact official lock-up. It is rendered as a CSS background instead of through
 * next/image so local development never depends on the image optimizer route.
 */
export function OfficialLogo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      role="img"
      aria-label="TwoDots | AI Core"
      className={cn(
        'brand-lockup block shrink-0 bg-contain bg-left bg-no-repeat',
        compact ? 'h-7 w-[164px]' : 'h-9 w-[214px]',
        className,
      )}
    />
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="td-blue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#35A2FF" />
          <stop offset="1" stopColor="#0B63F5" />
        </linearGradient>
      </defs>
      <path
        d="M61 25 C59 38 35 34 34 47 C33 60 57 57 56 67 C55 76 42 78 36 74"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
      />
      <circle cx="73" cy="16" r="15" fill="#FF7564" />
      <circle cx="22" cy="80" r="15" fill="url(#td-blue)" />
    </svg>
  );
}

export function Logo({
  className,
  tagline,
}: {
  className?: string;
  tagline?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <OfficialLogo />
      {tagline ? <span className="text-xs text-ink-3">{tagline}</span> : null}
    </div>
  );
}
