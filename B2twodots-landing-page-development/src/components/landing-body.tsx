"use client";

import { motion } from "framer-motion";
import {
  Hammer,
  Wrench,
  Heart,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Palette,
  Globe2,
  Workflow,
  Bot,
  Plus,
} from "lucide-react";
import { Kicker } from "./brand";
import { Badge } from "./ui";
import type { Dict, Locale, VentureStatus } from "@/lib/i18n";
import { ventureStatus } from "@/lib/i18n";
import type { Venture } from "@/db/schema";

/* --------------------------------- MISSION --------------------------------- */

export function Mission({ t }: { t: Dict }) {
  const icons = [Hammer, Wrench, Heart];
  return (
    <section id="mission" className="relative scroll-mt-20 bg-ink py-24 text-white sm:py-32 overflow-hidden">
      <div className="dotgrid-dark absolute inset-0 opacity-50" />
      <div className="absolute right-0 top-0 size-[380px] rounded-full bg-brand/20 blur-[120px]" />

      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div>
            <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
              <Kicker tone="dark">{t.mission.kicker}</Kicker>
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: 0.08 }}
              className="mt-5 text-3xl font-extrabold tracking-tight sm:text-5xl"
            >
              {t.mission.title}
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: 0.16 }}
              className="mt-6 max-w-md text-lg leading-relaxed text-white/70"
            >
              {t.mission.lead}
            </motion.p>

            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="mt-10"
            >
              <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/40">{t.mission.valuesLabel}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {t.mission.values.map((v) => (
                  <span key={v} className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[12.5px] font-medium text-white/80">
                    {v}
                  </span>
                ))}
              </div>
            </motion.div>
          </div>

          <div className="flex flex-col gap-4">
            {t.mission.cards.map((c, i) => {
              const Icon = icons[i];
              return (
                <motion.div
                  key={c.title}
                  initial={{ opacity: 0, x: 28 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ delay: i * 0.12 }}
                  className="group flex items-start gap-5 rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition hover:border-brand/50 hover:bg-white/[0.07] sm:p-7"
                >
                  <span className="rounded-xl bg-brand p-3 text-white shadow-[0_10px_24px_-10px_rgb(37_99_235/0.9)]">
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold">{c.title}</h3>
                    <p className="mt-1.5 text-[14.5px] leading-relaxed text-white/60">{c.text}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- METHOD ---------------------------------- */

export function Method({ t }: { t: Dict }) {
  return (
    <section id="methode" className="relative scroll-mt-20 py-24 sm:py-32 overflow-hidden">
      <div className="dotgrid-light absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
            <div className="flex justify-center"><Kicker>{t.method.kicker}</Kicker></div>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: 0.08 }}
            className="mt-5 text-3xl font-extrabold tracking-tight text-ink sm:text-5xl"
          >
            {t.method.title}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: 0.16 }}
            className="mt-5 text-[16px] text-steel"
          >
            {t.method.lead}
          </motion.p>
        </div>

        <div className="relative mx-auto mt-16 max-w-4xl">
          {/* spine */}
          <div className="absolute bottom-4 left-[22px] top-4 w-[2px] rounded bg-gradient-to-b from-brand/10 via-brand/40 to-brand/10 md:left-1/2 md:-translate-x-1/2" />

          <ol className="flex flex-col gap-8">
            {t.method.steps.map((s, i) => {
              const right = i % 2 === 1;
              return (
                <motion.li
                  key={s.t}
                  initial={{ opacity: 0, y: 26 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ delay: 0.05 }}
                  className={`relative flex md:items-center ${right ? "md:flex-row-reverse" : ""}`}
                >
                  {/* node */}
                  <span className="absolute left-[22px] top-6 z-10 -translate-x-1/2 md:left-1/2 md:top-1/2 md:-translate-y-1/2">
                    <span className="flex size-11 items-center justify-center rounded-full border-4 border-paper bg-brand text-[13px] font-bold text-white shadow-[0_6px_18px_-6px_rgb(37_99_235/0.8)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </span>

                  <div className={`ml-14 md:ml-0 md:w-1/2 ${right ? "md:pl-12" : "md:pr-12"}`}>
                    <motion.div
                      whileHover={{ y: -4 }}
                      className="rounded-2xl border border-ink/8 bg-white p-5 shadow-card sm:p-6"
                    >
                      <h3 className="text-[17px] font-bold text-ink">{s.t}</h3>
                      <p className="mt-1.5 text-[13.5px] leading-relaxed text-steel">{s.d}</p>
                    </motion.div>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- BRANDELY -------------------------------- */

export function Brandely({ t }: { t: Dict }) {
  const feats = [
    { icon: Palette, ...t.brandely.features[0] },
    { icon: Globe2, ...t.brandely.features[1] },
    { icon: Workflow, ...t.brandely.features[2] },
    { icon: Bot, ...t.brandely.features[3] },
  ];
  return (
    <section id="brandely" className="relative scroll-mt-20 py-10 sm:py-16">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="relative overflow-hidden rounded-[32px] bg-ink text-white shadow-lift"
        >
          <div className="dotgrid-dark absolute inset-0 opacity-40" />
          <div className="absolute -left-32 bottom-0 size-[420px] rounded-full bg-brand/30 blur-[130px]" />

          <div className="relative grid gap-12 p-8 sm:p-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:p-16">
            <div>
              <div className="flex items-center gap-3">
                <Kicker tone="dark">{t.brandely.kicker}</Kicker>
                <span className="rounded-full bg-brand px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-white">
                  {t.brandely.badge}
                </span>
              </div>
              <h2 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-[42px] sm:leading-[1.1]">
                {t.brandely.title}
              </h2>
              <p className="mt-5 max-w-lg text-[15.5px] leading-relaxed text-white/70">{t.brandely.lead}</p>

              <a
                href="#ecosysteme"
                className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-ink transition hover:bg-mist active:scale-95"
              >
                {t.brandely.cta}
                <ArrowRight className="size-4" />
              </a>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2">
              {feats.map((f, i) => (
                <motion.div
                  key={f.t}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.15 + i * 0.1 }}
                  className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 transition hover:border-brand/60 hover:bg-white/[0.08]"
                >
                  <f.icon className="size-5 text-brand" />
                  <h3 className="mt-3.5 text-[15px] font-bold">{f.t}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">{f.d}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* mini product strip */}
          <div className="relative border-t border-white/10 bg-white/[0.03] px-8 py-5 sm:px-16">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-[12.5px] font-medium text-white/60">
              <span className="flex items-center gap-2"><Sparkles className="size-4 text-brand" /> brandely.app</span>
              {["Positionnement", "Identité visuelle", "Site web", "Lancement"].map((x) => (
                <span key={x} className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-brand" /> {x}
                </span>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* -------------------------------- ECOSYSTEM -------------------------------- */

const statusColor: Record<VentureStatus, string> = {
  idee: "#475569",
  incubation: "#7c5cfc",
  developpement: "#2563EB",
  lancee: "#059669",
};

export function Ecosystem({
  t,
  locale,
  ventures,
}: {
  t: Dict;
  locale: Locale;
  ventures: Venture[];
}) {
  const labels = ventureStatus[locale];
  return (
    <section id="ecosysteme" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }}>
            <div className="flex justify-center"><Kicker>{t.eco.kicker}</Kicker></div>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: 0.08 }}
            className="mt-5 text-3xl font-extrabold tracking-tight text-ink sm:text-5xl"
          >
            {t.eco.title}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: 0.16 }}
            className="mt-5 text-[16px] text-steel"
          >
            {t.eco.lead}
          </motion.p>
        </div>

        {/* root node */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          className="mx-auto mt-14 w-fit"
        >
          <div className="flex items-center gap-3.5 rounded-2xl bg-ink px-6 py-4 text-white shadow-lift">
            <span className="flex gap-1.5">
              <span className="size-3.5 rounded-full bg-brand" />
              <span className="size-3.5 rounded-full bg-white" />
            </span>
            <div>
              <p className="text-[15px] font-bold leading-none">TwoDots.ca</p>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-white/50">{t.eco.root}</p>
            </div>
          </div>
        </motion.div>

        {/* connectors */}
        <div className="mx-auto h-10 w-[2px] bg-gradient-to-b from-ink/40 to-brand/30" />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ventures.map((v, i) => (
            <motion.article
              key={v.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.08 }}
              className="group relative overflow-hidden rounded-2xl border border-ink/8 bg-white p-6 shadow-card transition hover:-translate-y-1 hover:shadow-lift"
            >
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: v.accent }} />
              <div className="flex items-start justify-between gap-3">
                <span className="flex gap-1.5 pt-1">
                  <span className="size-3 rounded-full bg-brand" />
                  <span className="size-3 rounded-full" style={{ background: v.accent }} />
                </span>
                <Badge color={statusColor[v.status as VentureStatus] ?? "#475569"}>
                  {labels[v.status as VentureStatus] ?? v.status}
                </Badge>
              </div>
              <h3 className="mt-4 text-xl font-bold text-ink">{v.name}</h3>
              <p className="mt-1 text-[13.5px] font-medium text-brand">{v.tagline}</p>
              <p className="mt-2.5 text-[13px] leading-relaxed text-steel line-clamp-3">{v.description}</p>
              <div className="mt-4 flex items-center justify-between border-t border-ink/6 pt-3.5 text-[11.5px] font-medium text-steel/80">
                <span>{v.category}</span>
                <span>{v.year}</span>
              </div>
            </motion.article>
          ))}

          {/* future slot */}
          <motion.article
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: ventures.length * 0.08 }}
            className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand/30 bg-brand-soft/40 p-6 text-center transition hover:border-brand/60"
          >
            <span className="rounded-full bg-brand/10 p-3 text-brand">
              <Plus className="size-5" />
            </span>
            <h3 className="mt-3 text-lg font-bold text-ink">{t.eco.future}</h3>
            <p className="mt-1 text-[13px] text-steel">{t.eco.futureDesc}</p>
            <span className="mt-3 rounded-full bg-brand px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
              {t.eco.futureStatus}
            </span>
          </motion.article>
        </div>
      </div>
    </section>
  );
}
