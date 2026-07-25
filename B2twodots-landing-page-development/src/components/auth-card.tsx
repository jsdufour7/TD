"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, KeyRound, Sparkles } from "lucide-react";
import { Logo } from "./brand";
import { Button, Input, Label, Spinner, useToast } from "./ui";

export function AuthCard({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLogin = mode === "login";

  async function submit(e: FormEvent<HTMLFormElement>, override?: { email: string; password: string }) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = override ?? {
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
    };
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: mode, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Une erreur est survenue.");
        return;
      }
      toast("success", isLogin ? "Bon retour dans le studio." : "Bienvenue dans le studio.");
      window.location.href = "/dashboard";
    } catch {
      setError("Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="dotgrid-dark absolute inset-0 opacity-50" />
        <div className="absolute -bottom-24 -right-24 size-[420px] rounded-full bg-brand/25 blur-[120px]" />
        <div className="relative">
          <Logo tone="dark" href="/fr" />
        </div>
        <div className="relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-brand">Espace studio</p>
            <h2 className="mt-4 max-w-md text-4xl font-extrabold leading-[1.1] tracking-tight">
              Nous transformons les idées en entreprises.
            </h2>
            <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-white/60">
              Gérez l'écosystème, le pipeline d'idées et les conversations depuis un seul tableau de bord.
            </p>
          </motion.div>
          <div className="mt-10 flex items-center gap-3 text-white/50" aria-hidden>
            <span className="relative flex size-4">
              <span className="absolute inset-0 animate-ping rounded-full bg-brand/60" />
              <span className="relative size-4 rounded-full bg-brand" />
            </span>
            <span className="h-[2px] w-16 rounded bg-white/20" />
            <span className="size-4 rounded-full bg-white" />
          </div>
        </div>
        <p className="relative text-[12.5px] text-white/40">© 2026 TwoDots.ca — Montréal, Québec</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-paper px-5 py-12 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="mb-8 lg:hidden">
            <Logo href="/fr" />
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
            {isLogin ? "Accéder au studio" : "Créer votre espace"}
          </h1>
          <p className="mt-2 text-[14.5px] text-steel">
            {isLogin
              ? "Connectez-vous pour gérer l'écosystème TwoDots."
              : "Rejoignez le studio et commencez à bâtir."}
          </p>

          <form onSubmit={(e) => submit(e)} className="mt-8 flex flex-col gap-4">
            {!isLogin && (
              <div>
                <Label>Nom complet</Label>
                <Input name="name" required placeholder="Jeanne Dupont" autoComplete="name" />
              </div>
            )}
            <div>
              <Label>Courriel</Label>
              <Input name="email" type="email" required placeholder="vous@twodots.ca" autoComplete="email" />
            </div>
            <div>
              <Label>Mot de passe</Label>
              <Input name="password" type="password" required minLength={6} placeholder="••••••••" autoComplete={isLogin ? "current-password" : "new-password"} />
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] font-medium text-red-700"
              >
                {error}
              </motion.p>
            )}

            <Button type="submit" size="lg" className="mt-1 w-full" disabled={busy}>
              {busy && <Spinner />}
              {isLogin ? "Se connecter" : "Créer mon compte"}
              {!busy && <ArrowRight className="size-4" />}
            </Button>
          </form>

          {isLogin && (
            <form onSubmit={(e) => submit(e, { email: "demo@twodots.ca", password: "demo1234" })}>
              <Button type="submit" variant="outline" size="lg" className="mt-3 w-full" disabled={busy}>
                <KeyRound className="size-4" />
                Explorer avec le compte démo
              </Button>
            </form>
          )}

          <p className="mt-7 text-center text-[13.5px] text-steel">
            {isLogin ? "Pas encore de compte ?" : "Déjà membre du studio ?"}{" "}
            <Link href={isLogin ? "/signup" : "/login"} className="font-semibold text-brand hover:underline">
              {isLogin ? "Créer un espace" : "Se connecter"}
            </Link>
          </p>

          <p className="mt-6 flex items-center justify-center gap-2 text-[12px] text-steel/70">
            <Sparkles className="size-3.5 text-brand" />
            Deux points. Une transformation.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
