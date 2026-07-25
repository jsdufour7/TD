"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
} from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";
import { Building2, Lightbulb, Mail, Rocket, ArrowRight } from "lucide-react";
import { Skeleton, Badge } from "@/components/ui";
import type { Venture, Idea, Message } from "@/db/schema";
import { STAGE_LABELS, PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/constants";

ChartJS.register(ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale);

const STATUS_META: Record<string, { label: string; color: string }> = {
  idee: { label: "À l'étude", color: "#94a3b8" },
  incubation: { label: "Incubation", color: "#7c5cfc" },
  developpement: { label: "Développement", color: "#2563EB" },
  lancee: { label: "Lancée", color: "#059669" },
};

const STAGE_ORDER = ["exploration", "validation", "creation", "construction", "lancement"];

export default function OverviewPage() {
  const [ventures, setVentures] = useState<Venture[] | null>(null);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/ventures").then((r) => r.json()),
      fetch("/api/ideas").then((r) => r.json()),
      fetch("/api/messages").then((r) => r.json()),
    ]).then(([v, i, m]) => {
      setVentures(v.ventures ?? []);
      setIdeas(i.ideas ?? []);
      setMessages(m.messages ?? []);
    });
  }, []);

  const loading = !ventures || !ideas || !messages;
  const unread = messages?.filter((m) => !m.read).length ?? 0;
  const active = ventures?.filter((v) => v.status === "developpement" || v.status === "lancee").length ?? 0;

  const statusCounts = STAGE_ORDER.length
    ? (["idee", "incubation", "developpement", "lancee"] as const).map(
        (s) => ventures?.filter((v) => v.status === s).length ?? 0
      )
    : [];

  const doughnutData = {
    labels: (["idee", "incubation", "developpement", "lancee"] as const).map((s) => STATUS_META[s].label),
    datasets: [
      {
        data: statusCounts,
        backgroundColor: (["idee", "incubation", "developpement", "lancee"] as const).map((s) => STATUS_META[s].color),
        borderColor: "#ffffff",
        borderWidth: 3,
        hoverOffset: 6,
      },
    ],
  };

  const barData = {
    labels: STAGE_ORDER.map((s) => STAGE_LABELS[s]),
    datasets: [
      {
        label: "Idées",
        data: STAGE_ORDER.map((s) => ideas?.filter((i) => i.stage === s).length ?? 0),
        backgroundColor: "#2563EB",
        borderRadius: 8,
        maxBarThickness: 38,
      },
    ],
  };

  const stats = [
    { label: "Entreprises", value: ventures?.length ?? 0, icon: Building2, hint: "dans l'écosystème" },
    { label: "En construction", value: active, icon: Rocket, hint: "développement + lancement" },
    { label: "Idées au pipeline", value: ideas?.length ?? 0, icon: Lightbulb, hint: "de l'exploration au lancement" },
    { label: "Messages non lus", value: unread, icon: Mail, hint: "boîte de réception" },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-brand">Vue d'ensemble</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink">Le studio, en un coup d'œil.</h1>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/ideas" className="inline-flex h-10 items-center gap-2 rounded-full border border-ink/15 px-4 text-[13px] font-semibold text-ink transition hover:border-brand hover:text-brand">
            <Lightbulb className="size-4" /> Nouvelle idée
          </Link>
          <Link href="/dashboard/ventures" className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-[13px] font-semibold text-white transition hover:bg-brand-2">
            <Building2 className="size-4" /> Entreprises
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="rounded-2xl border border-ink/8 bg-white p-5 shadow-card"
          >
            <div className="flex items-center justify-between">
              <span className="rounded-xl bg-brand-soft p-2.5 text-brand">
                <s.icon className="size-[18px]" />
              </span>
              <span className="flex gap-1" aria-hidden>
                <span className="size-1.5 rounded-full bg-brand" />
                <span className="size-1.5 rounded-full bg-ink" />
              </span>
            </div>
            {loading ? (
              <Skeleton className="mt-4 h-9 w-16" />
            ) : (
              <p className="mt-4 text-[34px] font-extrabold leading-none tracking-tight text-ink">{s.value}</p>
            )}
            <p className="mt-2 text-[13.5px] font-semibold text-ink">{s.label}</p>
            <p className="text-[12px] text-steel">{s.hint}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-ink/8 bg-white p-6 shadow-card">
          <h2 className="text-[15px] font-bold text-ink">Maturité de l'écosystème</h2>
          <p className="text-[12.5px] text-steel">Répartition des entreprises par statut</p>
          <div className="mt-4 h-[240px]">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <Doughnut
                data={doughnutData}
                options={{
                  maintainAspectRatio: false,
                  cutout: "68%",
                  plugins: {
                    legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", padding: 16, font: { family: "Poppins", size: 12 } } },
                  },
                }}
              />
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-ink/8 bg-white p-6 shadow-card">
          <h2 className="text-[15px] font-bold text-ink">Pipeline d'idées</h2>
          <p className="text-[12.5px] text-steel">Idées par étape de la méthode</p>
          <div className="mt-4 h-[240px]">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <Bar
                data={barData}
                options={{
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: { beginAtZero: true, ticks: { precision: 0, font: { family: "Poppins", size: 11 } }, grid: { color: "rgba(13,19,33,0.06)" } },
                    x: { ticks: { font: { family: "Poppins", size: 11 } }, grid: { display: false } },
                  },
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Recent */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-ink/8 bg-white p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-ink">Dernières idées</h2>
            <Link href="/dashboard/ideas" className="flex items-center gap-1 text-[12.5px] font-semibold text-brand hover:underline">
              Tout voir <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <ul className="mt-4 flex flex-col divide-y divide-ink/6">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <li key={i} className="py-3"><Skeleton className="h-5 w-full" /></li>
                ))
              : ideas?.slice(0, 4).map((idea) => (
                  <li key={idea.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-ink">{idea.title}</p>
                      <p className="text-[12px] text-steel">{STAGE_LABELS[idea.stage]}</p>
                    </div>
                    <Badge color={PRIORITY_COLORS[idea.priority]}>{PRIORITY_LABELS[idea.priority]}</Badge>
                  </li>
                ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-ink/8 bg-white p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-ink">Derniers messages</h2>
            <Link href="/dashboard/messages" className="flex items-center gap-1 text-[12.5px] font-semibold text-brand hover:underline">
              Boîte de réception <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <ul className="mt-4 flex flex-col divide-y divide-ink/6">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <li key={i} className="py-3"><Skeleton className="h-5 w-full" /></li>
                ))
              : messages?.slice(0, 3).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-ink">
                        {!m.read && <span className="mr-2 inline-block size-2 rounded-full bg-brand" />}
                        {m.name}
                      </p>
                      <p className="truncate text-[12px] text-steel">{m.subject || m.body}</p>
                    </div>
                    <span className="shrink-0 text-[11.5px] text-steel/70">
                      {new Date(m.createdAt).toLocaleDateString("fr-CA", { day: "numeric", month: "short" })}
                    </span>
                  </li>
                ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
