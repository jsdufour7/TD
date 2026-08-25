'use client';

import { ArrowRight, Mic, Sparkles } from 'lucide-react';
import { cn } from '@/lib/ui';
import { openCoo } from '@/lib/ui-events';
import { Button } from '@/components/ui/primitives';

/**
 * Mission Control entry point.
 *
 * The home page is a server component (it renders live queries); this is the one
 * piece that needs the client — the buttons that hand an intention to the COO.
 */
export function MissionHero({
  userName,
  attention,
  canWork,
}: {
  userName: string;
  attention: { approvals: number; failedRuns: number; blockedTasks: number };
  canWork: boolean;
}) {
  const total = attention.approvals + attention.failedRuns + attention.blockedTasks;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

  const intents = [
    { label: 'État du projet', prompt: 'Où en sommes-nous ? Fais une synthèse.' },
    { label: 'Ce qui bloque', prompt: 'Qu’est-ce qui est bloqué, et que fais-tu pour le débloquer ?' },
    { label: 'Vérifier et livrer', prompt: 'Lance la vérification complète (typecheck, lint, tests) et corrige ce qui échoue.' },
  ];

  return (
    <section className="relative overflow-hidden rounded-xl border border-line bg-surface-1 p-5 shadow-card edge-top">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
      <div
        className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full opacity-[0.13] blur-3xl"
        style={{ background: 'var(--color-accent)' }}
        aria-hidden="true"
      />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-[0.08em] text-ink-4 uppercase">
            {greeting}, {userName.split(' ')[0]}
          </p>
          <h2 className="mt-1.5 text-[17px] leading-snug font-semibold tracking-tight text-ink-1">
            {total > 0
              ? `${total} élément${total > 1 ? 's' : ''} réclame${total > 1 ? 'nt' : ''} votre décision.`
              : 'Rien ne bloque. Le COO tient le cap.'}
          </h2>
          <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-3">
            {attention.approvals > 0 ? `${attention.approvals} approbation${attention.approvals > 1 ? 's' : ''} en attente. ` : ''}
            {attention.failedRuns > 0 ? `${attention.failedRuns} échec${attention.failedRuns > 1 ? 's' : ''} à traiter. ` : ''}
            {attention.blockedTasks > 0 ? `${attention.blockedTasks} tâche${attention.blockedTasks > 1 ? 's' : ''} bloquée${attention.blockedTasks > 1 ? 's' : ''}. ` : ''}
            {canWork ? 'Donnez une intention au COO : il planifie, délègue, vérifie et vous rapporte.' : 'Créez un projet pour donner du travail au COO.'}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="primary" size="md" onClick={() => openCoo({ source: 'mission-control' })} disabled={!canWork}>
            <Sparkles className="size-4" />
            Parler au COO
          </Button>
          <a href="/drive">
            <Button variant="outline" size="md">
              <Mic className="size-4" />
              Mode Voiture
            </Button>
          </a>
        </div>
      </div>

      {canWork ? (
        <div className="relative mt-4 flex flex-wrap gap-1.5">
          {intents.map((intent) => (
            <button
              key={intent.label}
              type="button"
              onClick={() => openCoo({ prefill: intent.prompt, source: 'mission-control' })}
              className={cn(
                'group inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-0/60 px-3 py-1.5',
                'text-[11.5px] text-ink-3 transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent',
              )}
            >
              {intent.label}
              <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
