"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Lightbulb, Building2, Menu, X } from "lucide-react";
import { Logo, Kicker } from "./brand";
import { cn } from "./ui";
import type { Dict, Locale } from "@/lib/i18n";

/* ---------------------------------- NAV ----------------------------------- */

export function Nav({ locale, t }: { locale: Locale; t: Dict }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    ["#concept", t.nav.storytelling],
    ["#mission", t.nav.mission],
    ["#methode", t.nav.methode],
    ["#ecosysteme", t.nav.ecosysteme],
    ["#vision", t.nav.vision],
  ] as const;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled ? "bg-paper/85 backdrop-blur-md border-b border-ink/8 shadow-[0_8px_30px_-18px_rgb(13_19_33/0.25)]" : "bg-transparent"
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
        <Logo href={`/${locale}`} />

        <nav className="hidden items-center gap-7 lg:flex">
          {links.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="text-[13.5px] font-medium text-steel transition hover:text-ink"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden items-center rounded-full border border-ink/10 bg-white/70 p-1 text-[12px] font-semibold sm:flex">
            {(["fr", "en"] as Locale[]).map((l) => (
              <Link
                key={l}
                href={`/${l}`}
                className={cn(
                  "rounded-full px-2.5 py-1 uppercase tracking-wide transition",
                  locale === l ? "bg-ink text-white" : "text-steel hover:text-ink"
                )}
              >
                {l}
              </Link>
            ))}
          </div>
          <Link
            href="/login"
            className="hidden sm:inline-flex items-center gap-2 rounded-full bg-ink px-4 h-10 text-[13px] font-semibold text-white transition hover:bg-ink-3 active:scale-95"
          >
            {t.nav.studio}
            <ArrowUpRight className="size-3.5" />
          </Link>
          <button
            className="rounded-full p-2 text-ink lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-ink/8 bg-paper px-5 py-4 lg:hidden">
          <div className="flex flex-col gap-1">
            {links.map(([href, label]) => (
              <a
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-ink hover:bg-ink/5"
              >
                {label}
              </a>
            ))}
            <div className="mt-2 flex items-center gap-3">
              <Link href="/login" className="flex-1 rounded-full bg-ink px-4 py-2.5 text-center text-sm font-semibold text-white">
                {t.nav.studio}
              </Link>
              <div className="flex items-center rounded-full border border-ink/10 p-1 text-[12px] font-semibold">
                {(["fr", "en"] as Locale[]).map((l) => (
                  <Link key={l} href={`/${l}`} className={cn("rounded-full px-2.5 py-1 uppercase", locale === l ? "bg-ink text-white" : "text-steel")}>
                    {l}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

/* ---------------------------------- HERO ----------------------------------- */

function IdeaDevice({ t }: { t: Dict }) {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-ink p-7 sm:p-9 shadow-lift">
      <div className="dotgrid-dark absolute inset-0 opacity-60" />
      <div className="absolute -right-24 -top-24 size-72 rounded-full bg-brand/25 blur-[90px]" />

      <div className="relative">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
          <span>two<span className="text-brand">dots</span>.ca</span>
          <span>2026</span>
        </div>

        {/* The transformation track */}
        <div className="mt-10 flex items-center gap-4 sm:gap-6">
          <div className="flex flex-col items-center gap-3">
            <span className="relative flex size-14 sm:size-16 items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-brand/40 animate-ping [animation-duration:2.4s]" />
              <span className="relative size-14 sm:size-16 rounded-full bg-brand shadow-[0_0_40px_rgb(37_99_235/0.6)]" />
            </span>
            <span className="text-[12px] font-semibold uppercase tracking-widest text-white/70">{t.hero.from}</span>
          </div>

          <div className="relative h-[2px] flex-1 rounded-full bg-white/12">
            <div className="absolute inset-0 overflow-hidden rounded-full">
              <motion.span
                className="absolute top-1/2 -mt-[3px] size-1.5 rounded-full bg-white shadow-[0_0_12px_#fff]"
                animate={{ left: ["0%", "100%"] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.4 }}
              />
              <motion.span
                className="absolute top-1/2 -mt-[3px] size-1.5 rounded-full bg-brand shadow-[0_0_12px_#2563eb]"
                animate={{ left: ["0%", "100%"] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 1.6, repeatDelay: 0.4 }}
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-3">
            <span className="size-14 sm:size-16 rounded-full bg-white shadow-[0_0_40px_rgb(255_255_255/0.35)]" />
            <span className="text-[12px] font-semibold uppercase tracking-widest text-white/70">{t.hero.to}</span>
          </div>
        </div>

        {/* Path words */}
        <div className="mt-8 grid grid-cols-4 gap-2">
          {t.story.path.map((w, i) => (
            <motion.div
              key={w}
              initial={{ opacity: 0.25 }}
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 3.2, repeat: Infinity, delay: i * 0.8, ease: "easeInOut" }}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-center text-[10.5px] sm:text-[11.5px] font-medium text-white/80"
            >
              {w}
            </motion.div>
          ))}
        </div>

        {/* Floating chips */}
        <div className="mt-7 flex flex-wrap gap-2">
          {t.hero.chips.map((c, i) => (
            <motion.span
              key={c}
              animate={{ y: [0, -5, 0] }}
              transition={{ duration: 3 + i * 0.4, repeat: Infinity, ease: "easeInOut" }}
              className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-[11.5px] font-medium text-white/75"
            >
              {c}
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Hero({ locale, t }: { locale: Locale; t: Dict }) {
  return (
    <section className="relative overflow-hidden pt-[72px]">
      <div className="dotgrid-light absolute inset-0 [mask-image:radial-gradient(80%_70%_at_50%_30%,black,transparent)]" />
      <div className="absolute -left-40 top-10 size-[420px] rounded-full bg-brand/10 blur-[110px]" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-28 lg:pt-20">
        <div>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <Kicker>{t.hero.eyebrow}</Kicker>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08 }}
            className="mt-6 text-[42px] font-extrabold leading-[1.04] tracking-tight text-ink sm:text-6xl lg:text-[68px]"
          >
            {t.hero.titleA}{" "}
            <span className="relative inline-block text-brand">
              {t.hero.titleIdea}
              <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 200 12" fill="none" preserveAspectRatio="none" aria-hidden>
                <path d="M3 9C60 3 140 3 197 8" stroke="#2563EB" strokeWidth="4" strokeLinecap="round" opacity="0.35" />
              </svg>
            </span>
            <br />
            {t.hero.titleB}{" "}
            <span className="relative inline-block">
              {t.hero.titleBiz}
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.18 }}
            className="mt-7 max-w-xl text-[16px] leading-relaxed text-steel sm:text-[17px]"
          >
            {t.hero.subtitle}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.28 }}
            className="mt-9 flex flex-wrap items-center gap-4"
          >
            <a
              href="#vision"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 text-[15px] font-semibold text-white shadow-[0_14px_30px_-12px_rgb(37_99_235/0.8)] transition hover:bg-brand-2 active:scale-95"
            >
              {t.hero.ctaVision}
              <ArrowRight className="size-4" />
            </a>
            <a
              href="#brandely"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-ink/15 bg-white/60 px-6 text-[15px] font-semibold text-ink transition hover:border-brand hover:text-brand active:scale-95"
            >
              {t.hero.ctaBrandely}
            </a>
          </motion.div>

          <motion.dl
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.45 }}
            className="mt-12 flex flex-wrap gap-x-10 gap-y-5 border-t border-ink/8 pt-7"
          >
            {[
              ["04", t.hero.statVentures],
              ["09", t.hero.statSteps],
              ["01", t.hero.statPlatform],
            ].map(([n, label]) => (
              <div key={n}>
                <dt className="sr-only">{label}</dt>
                <dd className="flex items-baseline gap-2.5">
                  <span className="text-3xl font-extrabold tracking-tight text-ink">{n}</span>
                  <span className="max-w-[150px] text-[12.5px] leading-snug text-steel">{label}</span>
                </dd>
              </div>
            ))}
          </motion.dl>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <IdeaDevice t={t} />
        </motion.div>
      </div>

      {/* Method marquee divider */}
      <div className="relative border-y border-ink/8 bg-white/60 py-3.5 overflow-hidden">
        <div className="flex w-max animate-marquee gap-0 whitespace-nowrap">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex items-center" aria-hidden={dup === 1}>
              {t.method.steps.map((s, i) => (
                <span key={`${dup}-${s.t}`} className="flex items-center text-[12.5px] font-semibold uppercase tracking-[0.18em] text-steel/70">
                  <span className="px-5">{String(i + 1).padStart(2, "0")} · {s.t}</span>
                  <span className="size-1.5 rounded-full bg-brand/50" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- STORYTELLING ------------------------------ */

export function Story({ t }: { t: Dict }) {
  return (
    <section id="concept" className="relative scroll-mt-20 overflow-hidden py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
            <div className="flex justify-center"><Kicker>{t.story.kicker}</Kicker></div>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: 0.08 }}
            className="mt-5 text-3xl font-extrabold tracking-tight text-ink sm:text-5xl"
          >
            {t.story.title}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: 0.16 }}
            className="mx-auto mt-6 max-w-2xl text-[16px] leading-relaxed text-steel"
          >
            {t.story.lead}
          </motion.p>
        </div>

        {/* The journey */}
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          className="relative mx-auto mt-16 max-w-4xl rounded-[28px] border border-ink/8 bg-white p-8 shadow-card sm:p-12"
        >
          <div className="flex items-center justify-between gap-4 sm:gap-8">
            <div className="flex w-24 flex-col items-center gap-3 sm:w-32">
              <span className="relative flex size-16 items-center justify-center sm:size-20">
                <motion.span
                  className="absolute inset-0 rounded-full bg-brand/25"
                  variants={{ show: { scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }, hidden: {} }}
                  transition={{ duration: 2.6, repeat: Infinity }}
                />
                <span className="relative flex size-16 items-center justify-center rounded-full bg-brand-soft sm:size-20">
                  <Lightbulb className="size-7 text-brand sm:size-8" />
                </span>
              </span>
              <span className="text-sm font-bold text-ink sm:text-base">{t.story.idea}</span>
              <span className="text-center text-[11.5px] leading-snug text-steel sm:text-xs">{t.story.ideaDesc}</span>
            </div>

            <div className="relative h-[3px] flex-1 rounded-full bg-mist">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-brand"
                variants={{ hidden: { width: "0%" }, show: { width: "100%" } }}
                transition={{ duration: 2.2, ease: "easeInOut", delay: 0.3 }}
              />
              <div className="absolute -top-9 left-0 right-0 flex justify-between px-1">
                {t.story.path.map((w, i) => (
                  <motion.span
                    key={w}
                    variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                    transition={{ delay: 0.5 + i * 0.5 }}
                    className="text-[10px] font-semibold uppercase tracking-wider text-steel sm:text-[11px]"
                  >
                    {w}
                  </motion.span>
                ))}
              </div>
              <motion.span
                className="absolute top-1/2 size-4 -mt-2 rounded-full bg-brand shadow-[0_0_16px_rgb(37_99_235/0.8)]"
                variants={{ hidden: { left: "0%" }, show: { left: "calc(100% - 16px)" } }}
                transition={{ duration: 2.2, ease: "easeInOut", delay: 0.3 }}
              />
            </div>

            <div className="flex w-24 flex-col items-center gap-3 sm:w-32">
              <motion.span
                className="flex size-16 items-center justify-center rounded-full bg-ink sm:size-20"
                variants={{ hidden: { scale: 0.8, opacity: 0.4 }, show: { scale: 1, opacity: 1 } }}
                transition={{ delay: 2.2, type: "spring", stiffness: 200 }}
              >
                <Building2 className="size-7 text-white sm:size-8" />
              </motion.span>
              <span className="text-sm font-bold text-ink sm:text-base">{t.story.business}</span>
              <span className="text-center text-[11.5px] leading-snug text-steel sm:text-xs">{t.story.bizDesc}</span>
            </div>
          </div>

          <motion.p
            variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
            transition={{ delay: 2.5 }}
            className="mt-10 text-center text-sm font-semibold text-brand"
          >
            {t.story.between}
          </motion.p>
        </motion.div>

        {/* Brand mantras */}
        <div className="mx-auto mt-14 grid max-w-4xl gap-4 sm:grid-cols-3">
          {t.story.lines.map((line, i) => (
            <motion.div
              key={line}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12 }}
              className="rounded-2xl border border-ink/8 bg-white px-6 py-5 text-center shadow-card"
            >
              <p className="text-[15px] font-semibold text-ink">{line}</p>
            </motion.div>
          ))}
        </div>
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="mt-8 text-center text-[13px] font-semibold uppercase tracking-[0.25em] text-steel"
        >
          {t.story.motto}
        </motion.p>
      </div>
    </section>
  );
}
