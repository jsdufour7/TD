"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Mail, MapPin, Send } from "lucide-react";
import { Logo, Kicker } from "./brand";
import { Button, Input, Label, Textarea, Spinner, useToast } from "./ui";
import type { Dict, Locale } from "@/lib/i18n";

/* ---------------------------------- VISION --------------------------------- */

export function Vision({ t }: { t: Dict }) {
  return (
    <section id="vision" className="relative scroll-mt-20 overflow-hidden bg-ink py-28 text-white sm:py-36">
      <div className="dotgrid-dark absolute inset-0 opacity-60" />
      <div className="absolute left-1/2 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/15 blur-[140px]" />

      {/* giant colon motif */}
      <div className="pointer-events-none absolute right-[6%] top-1/2 hidden -translate-y-1/2 flex-col gap-10 opacity-[0.14] lg:flex" aria-hidden>
        <span className="size-24 rounded-full bg-brand" />
        <span className="size-24 rounded-full bg-white" />
      </div>

      <div className="relative mx-auto max-w-4xl px-5 text-center sm:px-8">
        <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
          <div className="flex justify-center"><Kicker tone="dark">{t.vision.kicker}</Kicker></div>
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ delay: 0.08 }}
          className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl"
        >
          {t.vision.title}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ delay: 0.16 }}
          className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-white/70"
        >
          {t.vision.lead}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ delay: 0.24 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <Link
            href="/signup"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-7 text-[15px] font-semibold text-white shadow-[0_16px_36px_-14px_rgb(37_99_235/0.9)] transition hover:bg-brand-2 active:scale-95"
          >
            {t.vision.cta}
            <ArrowRight className="size-4" />
          </Link>
          <a
            href="#contact"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-white/20 px-7 text-[15px] font-semibold text-white transition hover:border-white/50 active:scale-95"
          >
            {t.vision.cta2}
          </a>
        </motion.div>
      </div>
    </section>
  );
}

/* --------------------------------- CONTACT --------------------------------- */

export function Contact({ t }: { t: Dict }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          email: fd.get("email"),
          subject: fd.get("subject"),
          body: fd.get("body"),
        }),
      });
      if (!res.ok) throw new Error("fail");
      setDone(true);
      toast("success", t.contact.success);
      (e.currentTarget as HTMLFormElement).reset();
      setTimeout(() => setDone(false), 4000);
    } catch {
      toast("error", t.contact.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="contact" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-14 px-5 sm:px-8 lg:grid-cols-2 lg:gap-20">
        <div>
          <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
            <Kicker>{t.contact.kicker}</Kicker>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: 0.08 }}
            className="mt-5 text-3xl font-extrabold tracking-tight text-ink sm:text-5xl"
          >
            {t.contact.title}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: 0.16 }}
            className="mt-5 max-w-md text-[16px] leading-relaxed text-steel"
          >
            {t.contact.lead}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.24 }}
            className="mt-9 flex flex-col gap-4"
          >
            <a href="mailto:hello@twodots.ca" className="group flex w-fit items-center gap-3 text-[15px] font-semibold text-ink transition hover:text-brand">
              <span className="rounded-full bg-brand-soft p-2.5 text-brand"><Mail className="size-4" /></span>
              hello@twodots.ca
            </a>
            <p className="flex w-fit items-center gap-3 text-[15px] font-medium text-steel">
              <span className="rounded-full bg-brand-soft p-2.5 text-brand"><MapPin className="size-4" /></span>
              Montréal, Québec
            </p>
          </motion.div>
        </div>

        <motion.form
          onSubmit={onSubmit}
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          className="rounded-[24px] border border-ink/8 bg-white p-7 shadow-card sm:p-9"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>{t.contact.name}</Label>
              <Input name="name" required placeholder="Jeanne Dupont" />
            </div>
            <div>
              <Label>{t.contact.email}</Label>
              <Input name="email" type="email" required placeholder="jeanne@exemple.ca" />
            </div>
          </div>
          <div className="mt-4">
            <Label>{t.contact.subject}</Label>
            <Input name="subject" placeholder={t.contact.subjectPlaceholder} />
          </div>
          <div className="mt-4">
            <Label>{t.contact.body}</Label>
            <Textarea name="body" required placeholder="…" />
          </div>
          <Button type="submit" size="lg" className="mt-6 w-full" disabled={busy}>
            {busy ? <Spinner /> : done ? null : <Send className="size-4" />}
            {busy ? t.contact.sending : done ? t.contact.success : t.contact.send}
          </Button>
        </motion.form>
      </div>
    </section>
  );
}

/* ---------------------------------- FOOTER --------------------------------- */

export function Footer({ t, locale, ventures }: { t: Dict; locale: Locale; ventures: string[] }) {
  return (
    <footer className="border-t border-white/8 bg-ink text-white">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <Logo tone="dark" href={`/${locale}`} />
            <p className="mt-5 max-w-xs text-[14.5px] leading-relaxed text-white/60">{t.footer.slogan}</p>
            <div className="mt-6 flex gap-1.5" aria-hidden>
              <span className="size-2.5 rounded-full bg-brand" />
              <span className="size-2.5 rounded-full bg-white" />
            </div>
          </div>

          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-white/40">TwoDots</p>
            <ul className="mt-4 flex flex-col gap-2.5 text-[14px] text-white/70">
              <li><a href="#concept" className="transition hover:text-white">{t.nav.storytelling}</a></li>
              <li><a href="#mission" className="transition hover:text-white">{t.nav.mission}</a></li>
              <li><a href="#methode" className="transition hover:text-white">{t.nav.methode}</a></li>
              <li><a href="#vision" className="transition hover:text-white">{t.nav.vision}</a></li>
            </ul>
          </div>

          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-white/40">{t.nav.ecosysteme}</p>
            <ul className="mt-4 flex flex-col gap-2.5 text-[14px] text-white/70">
              {ventures.map((v) => (
                <li key={v}><a href="#ecosysteme" className="transition hover:text-white">{v}</a></li>
              ))}
              <li><a href="#ecosysteme" className="text-brand transition hover:text-white">{t.eco.future} →</a></li>
            </ul>
          </div>

          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-white/40">{t.nav.contact}</p>
            <ul className="mt-4 flex flex-col gap-2.5 text-[14px] text-white/70">
              <li><a href="mailto:hello@twodots.ca" className="transition hover:text-white">hello@twodots.ca</a></li>
              <li>Montréal, Québec</li>
              <li className="pt-2">
                <Link href="/login" className="inline-flex items-center gap-1.5 font-semibold text-brand transition hover:text-white">
                  {t.footer.studioLink} <ArrowRight className="size-3.5" />
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/8 pt-7 text-[12.5px] text-white/45 sm:flex-row">
          <p>© 2026 TwoDots.ca — {t.footer.rights}</p>
          <p>{t.footer.madeIn}</p>
          <div className="flex items-center gap-2 rounded-full border border-white/10 p-1 text-[11px] font-semibold">
            {(["fr", "en"] as Locale[]).map((l) => (
              <Link key={l} href={`/${l}`} className={`rounded-full px-2.5 py-1 uppercase transition ${locale === l ? "bg-white text-ink" : "text-white/60 hover:text-white"}`}>
                {l}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
