import Link from "next/link";

export function DotMark({
  tone = "light",
  size = "md",
}: {
  /** light = dots for light backgrounds (blue + ink), dark = for dark backgrounds (blue + white) */
  tone?: "light" | "dark";
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "lg" ? "size-6" : size === "sm" ? "size-3.5" : "size-[18px]";
  const gap = size === "lg" ? "gap-2" : size === "sm" ? "gap-1" : "gap-1.5";
  return (
    <span className={`inline-flex items-center ${gap}`} aria-hidden>
      <span className={`${dim} rounded-full bg-brand shadow-[0_0_0_0_rgb(37_99_235/0.35)]`} />
      <span className={`${dim} rounded-full ${tone === "dark" ? "bg-white" : "bg-ink"}`} />
    </span>
  );
}

export function Logo({
  tone = "light",
  href,
  size = "md",
}: {
  tone?: "light" | "dark";
  href?: string;
  size?: "sm" | "md" | "lg";
}) {
  const word =
    size === "lg"
      ? "text-[26px]"
      : size === "sm"
        ? "text-lg"
        : "text-[21px]";
  const inner = (
    <span className="group inline-flex items-center gap-2.5">
      <span className="relative">
        <DotMark tone={tone} size={size} />
      </span>
      <span
        className={`${word} font-bold tracking-tight leading-none ${
          tone === "dark" ? "text-white" : "text-ink"
        }`}
      >
        TwoDots
        <span className="text-brand">.ca</span>
      </span>
    </span>
  );
  if (!href) return inner;
  return (
    <Link href={href} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand/60">
      {inner}
    </Link>
  );
}

export function Kicker({ children, tone = "light" }: { children: React.ReactNode; tone?: "light" | "dark" }) {
  return (
    <p
      className={`flex items-center gap-3 text-[12px] font-semibold uppercase tracking-[0.22em] ${
        tone === "dark" ? "text-brand" : "text-brand"
      }`}
    >
      <span className="h-[2px] w-8 rounded-full bg-brand" />
      {children}
    </p>
  );
}

/** Le « : » signature — deux points qui relient idée et entreprise. */
export function ColonMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex flex-col items-center gap-[0.35em] ${className}`} aria-hidden>
      <span className="size-[0.5em] rounded-full bg-brand" />
      <span className="size-[0.5em] rounded-full bg-current" />
    </span>
  );
}
