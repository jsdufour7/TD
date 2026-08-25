'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Bot, Download, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui/primitives';
import { LogoMark } from '@/components/brand/logo';

/**
 * Sign in.
 *
 * The bootstrap administrator is created on first boot from AI_CORE_BOOTSTRAP_*.
 *
 * No `useSearchParams()` here on purpose: it forces a Suspense boundary during
 * static prerendering and the server/client pair can disagree about its value —
 * one of the documented causes of hydration mismatch. The redirect target is
 * only needed inside the submit handler (after mount), so it is read from
 * `window.location.search` there instead of during render.
 */
export default function LoginPage() {
  return (
    <main className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />
      <div className="flex items-center justify-center bg-surface-0 p-6 sm:p-10">
        <LoginCard />
      </div>
    </main>
  );
}

const PILLARS = [
  {
    icon: Sparkles,
    title: 'Vous parlez, le COO orchestre',
    body: 'Un objectif en langage naturel devient un plan versionné, des tâches, des agents spécialisés et une vérification.',
  },
  {
    icon: Bot,
    title: '13 agents spécialisés',
    body: 'Architecture, code, tests, revue, sécurité, produit — chacun avec ses outils, ses permissions et son budget.',
  },
  {
    icon: ShieldCheck,
    title: 'Local d’abord, vérifié toujours',
    body: 'llama.cpp / Ollama en priorité, aucune donnée ne sort sans vous. Rien n’est « terminé » sans preuve.',
  },
];

function BrandPanel() {
  return (
    <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface-1 p-10 lg:flex">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -top-32 -left-24 size-[26rem] rounded-full opacity-[0.18] blur-3xl"
        style={{ background: 'var(--color-accent)' }}
        aria-hidden="true"
      />

      <div className="relative">
        <div className="flex items-center gap-3">
          <LogoMark className="size-9 text-ink-1" />
          <div className="flex items-baseline gap-2 leading-none">
            <span className="text-lg font-semibold tracking-tight text-ink-1">TwoDots</span>
            <span className="h-4 w-px self-center bg-line-strong" aria-hidden="true" />
            <span className="text-lg font-semibold tracking-tight">
              <span className="text-accent">AI</span>
              <span className="text-ink-1"> Core</span>
            </span>
          </div>
        </div>

        <h1 className="mt-12 max-w-md text-[2rem] leading-[1.15] font-semibold tracking-tight text-ink-1 text-balance">
          Le système d’exploitation du travail,
          <span className="text-accent"> piloté par votre COO.</span>
        </h1>
        <p className="mt-3 max-w-md text-[13.5px] leading-relaxed text-ink-3">
          Vous donnez l’intention. Le COO comprend, planifie, délègue, exécute, vérifie, replanifie et vous rapporte —
          avec l’état réel du projet, jamais une simulation.
        </p>
      </div>

      <ul className="relative mt-10 space-y-4">
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <li key={pillar.title} className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-accent">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink-1">{pillar.title}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{pillar.body}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="relative mt-10 text-[11px] text-ink-4">
        Sessions hachées côté serveur · passerelle modèle configurable · aucune donnée transmise sans votre accord.
      </p>
    </section>
  );
}

function LoginCard() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@twodots.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? 'Connexion refusée');
        return;
      }
      // `replace` already fetches a fresh RSC payload for the destination, so the
      // session-aware layout re-renders with the new cookie. Adding a
      // `router.refresh()` here would re-fetch AND ABORT that in-flight render;
      // React's dev profiler then measures the aborted AppLayout with an
      // -Infinity end time and throws "cannot have a negative time stamp".
      const redirectTo = new URLSearchParams(window.location.search).get('redirect');
      router.replace(redirectTo && redirectTo.startsWith('/') ? redirectTo : '/home');
    } catch {
      setError('Serveur injoignable. AI Core tourne-t-il ?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-7 lg:hidden">
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-8 text-ink-1" />
          <p className="text-base font-semibold tracking-tight">
            <span className="text-accent">AI</span> Core
          </p>
        </div>
      </div>

      <h2 className="text-xl font-semibold tracking-tight text-ink-1">Connexion</h2>
      <p className="mt-1 text-[13px] text-ink-3">Accédez à votre espace de pilotage.</p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Courriel" required>
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Mot de passe" required>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        {error ? (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
          Entrer
          <ArrowRight className="size-4" />
        </Button>
      </form>

      {/*
        Relative link on purpose: the live preview is served from a host whose id
        changes between sessions, so an absolute URL handed out in chat goes
        stale. A relative href resolves against whatever origin the browser is
        actually on. Placed on the login page because that page renders without a
        session, which matters when the preview iframe blocks third-party cookies.
      */}
      <a
        href="/download/twodots-ai-core.zip"
        download
        className="mt-3 flex items-center justify-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-2.5 text-[12px] text-ink-2 transition-colors hover:border-accent/40 hover:text-ink-1"
      >
        <Download className="size-3.5" />
        Télécharger le code source (.zip)
      </a>

      <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-ink-4">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        Les sessions sont stockées sous forme de jetons hachés. Les identifiants ne quittent jamais le serveur.
      </p>
    </div>
  );
}
