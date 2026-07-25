"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  Building2,
  Lightbulb,
  Mail,
  LogOut,
  ExternalLink,
  Menu,
  X,
} from "lucide-react";
import { Logo } from "./brand";
import { cn } from "./ui";
import type { publicUser } from "@/lib/auth";

type SessionUser = ReturnType<typeof publicUser>;

const NAV = [
  { href: "/dashboard", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/ventures", label: "Entreprises", icon: Building2 },
  { href: "/dashboard/ideas", label: "Idées", icon: Lightbulb },
  { href: "/dashboard/messages", label: "Messages", icon: Mail },
];

export function DashboardShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(() => {
    fetch("/api/messages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.messages) setUnread(d.messages.filter((m: { read: boolean }) => !m.read).length);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshUnread();
    const id = setInterval(refreshUnread, 25000);
    return () => clearInterval(id);
  }, [refreshUnread, pathname]);

  async function logout() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.push("/fr");
    router.refresh();
  }

  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col bg-ink text-white">
      <div className="flex h-[72px] items-center justify-between px-6">
        <Logo tone="dark" href="/dashboard" size="sm" />
        <button className="rounded-full p-1.5 text-white/60 hover:text-white lg:hidden" onClick={() => setOpen(false)} aria-label="Fermer le menu">
          <X className="size-5" />
        </button>
      </div>

      <p className="px-6 pt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/35">Studio</p>
      <nav className="mt-3 flex flex-col gap-1 px-3">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium transition",
                active ? "bg-brand text-white shadow-[0_10px_24px_-12px_rgb(37_99_235/0.9)]" : "text-white/60 hover:bg-white/5 hover:text-white"
              )}
            >
              <item.icon className="size-[18px]" />
              {item.label}
              {item.href === "/dashboard/messages" && unread > 0 && (
                <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-bold", active ? "bg-white text-brand" : "bg-brand text-white")}>
                  {unread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-3 pb-4">
        <Link
          href="/fr"
          className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium text-white/60 transition hover:bg-white/5 hover:text-white"
        >
          <ExternalLink className="size-[18px]" />
          Voir le site
        </Link>

        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-[12px] font-bold">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{user.name}</p>
            <p className="truncate text-[11.5px] text-white/45">{user.role}</p>
          </div>
          <button
            onClick={logout}
            aria-label="Se déconnecter"
            title="Se déconnecter"
            className="rounded-full p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-paper">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-[280px] lg:hidden"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
            >
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="lg:pl-[260px]">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-ink/8 bg-paper/85 px-5 backdrop-blur-md sm:px-8">
          <button className="rounded-full p-2 text-ink hover:bg-ink/5 lg:hidden" onClick={() => setOpen(true)} aria-label="Ouvrir le menu">
            <Menu className="size-5" />
          </button>
          <div className="hidden items-center gap-2 text-[12.5px] font-medium text-steel lg:flex">
            <span className="size-2 rounded-full bg-brand" />
            Studio TwoDots — tableau de bord
          </div>
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-steel">
            <span className="hidden sm:inline">{user.email}</span>
            <span className="flex size-8 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white lg:hidden">
              {initials}
            </span>
          </div>
        </header>

        <main className="px-5 py-8 sm:px-8 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
