'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Bot, Download, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui/primitives';
import { OfficialLogo } from '@/components/brand/logo';

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.08fr_0.92fr]">
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
    body: 'Un objectif en langage naturel devient un plan, des tâches, des agents spécialisés et une vérification.',
  },
  {
    icon: Bot,
    title: 'Des agents spécialisés',
    body: 'Architecture, code, tests, revue, sécurité et produit, avec outils, permissions et budgets.',
  },
  {
    icon: ShieldCheck,
    title: 'Local d’abord, vérifié toujours',
    body: 'llama.cpp / Ollama en priorité. Rien n’est présenté comme terminé sans preuve.',
  },
];

function BrandPanel() {
  return (
    <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-[#081426] p-10 lg:flex">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-25" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-40 -left-28 size-[32rem] rounded-full bg-accent/20 blur-3xl" aria-hidden="true" />

      <div className="relative">
        <OfficialLogo className="h-10 w-[238px]" />
        <h1 className="mt-14 max-w-lg text-[2.3rem] leading-[1.08] font-semibold tracking-[-0.035em] text-white text-balance">
          Intelligence <span className="text-accent">at the core</span> of the ecosystem.
        </h1>
        <p className="mt-4 max-w-md text-[13.5px] leading-relaxed text-slate-300">
          Votre centre de commande pour orchestrer projets, agents, modèles et compute à partir d’un COO autonome.
        </p>
      </div>

      <ul className="relative mt-10 grid gap-3">
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <li key={pillar.title} className="flex items-start gap-3 rounded-lg border border-white/8 bg-white/[0.035] p-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-md border border-accent/20 bg-accent/10 text-accent">
                <Icon className="size-4" />
              </span>
              <div>
                <p className="text-[13px] font-medium text-white">{pillar.title}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">{pillar.body}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="relative mt-10 text-[10.5px] text-slate-500">TwoDots AI Core · Votre intelligence opérationnelle unifiée.</p>
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
      <div className="mb-8 lg:hidden"><OfficialLogo className="h-9 w-[214px]" /></div>
      <p className="text-[10px] font-semibold tracking-[0.14em] text-accent uppercase">Bienvenue</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-1">Connexion à AI Core</h2>
      <p className="mt-1 text-[13px] text-ink-3">Accédez à votre espace de pilotage TwoDots.</p>

      <form onSubmit={submit} className="mt-7 space-y-4">
        <Field label="Courriel" required>
          <Input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </Field>
        <Field label="Mot de passe" required>
          <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </Field>
        {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
          Entrer <ArrowRight className="size-4" />
        </Button>
      </form>

      <a href="/download/twodots-ai-core.zip" download className="mt-3 flex items-center justify-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-2.5 text-[12px] text-ink-2 hover:border-accent/40">
        <Download className="size-3.5" />
        Télécharger le code source (.zip)
      </a>
      <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-ink-4">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        Les sessions sont stockées sous forme de jetons hachés.
      </p>
    </div>
  );
}
