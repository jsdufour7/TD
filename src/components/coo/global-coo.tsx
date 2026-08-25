'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CooExecutive } from './coo-executive';

type ProjectRef = { id: string; name: string };
type Attention = { approvals: number; failedRuns: number; blockedTasks: number };

type ThreadMessage = {
  id: string;
  role: string;
  authorName: string | null;
  agentKey: string | null;
  mode: string | null;
  runId: string | null;
  content: string;
  createdAt: string;
};
type Objective = { id: string; title: string; status: string; autonomyMode: string };

/**
 * Global COO — accessible par-dessus toute la plateforme, sans quitter la page.
 *
 * - Bouton flottant (coin bas-droit) avec badge d'attention (approvals + runs
 *   échoués + tâches bloquées).
 * - Cmd/Ctrl+K ouvre la command bar : tapez une intention naturelle, elle part au
 *   COO du projet courant.
 * - Drawer latéral droit : le COO connaît le projet de la page courante (UI
 *   context) et la conversation persiste (même thread que /coo et /drive).
 */
export function GlobalCoo({ projects, attention }: { projects: ProjectRef[]; attention: Attention }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [thread, setThread] = useState<ThreadMessage[] | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const cmdRef = useRef<HTMLInputElement | null>(null);

  const totalAttention = attention.approvals + attention.failedRuns + attention.blockedTasks;

  // Projet courant dérivé de l'URL (context awareness), sinon le premier projet.
  const currentProjectId = useMemo(() => {
    const m = /\/projects\/([a-f0-9-]{8,})/.exec(pathname ?? '');
    if (m?.[1] && projects.some((p) => p.id === m[1])) return m[1];
    return projects[0]?.id ?? null;
  }, [pathname, projects]);

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  // Cmd/Ctrl+K → command bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
        setTimeout(() => cmdRef.current?.focus(), 0);
      }
      if (e.key === 'Escape') {
        setCmdOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Charge le thread + objectives du projet courant à l'ouverture du drawer.
  const loadThread = useCallback(async (projectId: string) => {
    try {
      const [t, o] = await Promise.all([
        fetch(`/api/projects/${projectId}/coo/thread`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/projects/${projectId}/objectives`, { cache: 'no-store' }).then((r) => r.json()),
      ]);
      setThread((t.messages ?? []) as ThreadMessage[]);
      setObjectives((o.objectives ?? []) as Objective[]);
    } catch {
      setThread([]);
      setObjectives([]);
    }
  }, []);

  // Open the drawer and load the current project's thread (event-driven, so the
  // no-setState-in-effect rule is respected).
  function openCoo() {
    setOpen(true);
    if (currentProjectId) void loadThread(currentProjectId);
  }

  // Command bar → envoie au COO puis ouvre le drawer.
  async function submitCommand() {
    if (!query.trim() || !currentProjectId) return;
    const text = query.trim();
    setQuery('');
    setCmdOpen(false);
    setOpen(true);
    try {
      await fetch(`/api/projects/${currentProjectId}/coo/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text, autonomyMode: 'autonomous' }),
      });
      await loadThread(currentProjectId);
    } catch {
      /* le drawer affichera l'état */
    }
  }

  return (
    <>
      {/* Command bar (Cmd/Ctrl+K) */}
      {cmdOpen ? (
        <div className="fixed inset-x-0 top-0 z-[70] flex justify-center bg-black/50 p-4 pt-[12vh]" onClick={() => setCmdOpen(false)}>
          <div className="w-full max-w-xl rounded-xl border border-line-strong bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <form
              className="flex items-center gap-2 px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitCommand();
              }}
            >
              <span className="text-accent">⌘K</span>
              <input
                ref={cmdRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Demandez au COO : « Continue CoAdvisor », « Qu'est-ce qui nécessite mon attention ? »…"
                className="w-full bg-transparent text-[14px] text-ink-1 outline-none"
              />
              <button type="submit" className="rounded bg-accent px-2.5 py-1 text-[12px] text-accent-ink">
                Envoyer
              </button>
            </form>
            {currentProject ? (
              <p className="border-t border-line px-4 py-2 text-[11px] text-ink-4">
                Contexte : <span className="text-ink-2">{currentProject.name}</span> · {pathname}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Drawer COO */}
      {open ? (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="COO">
          <button type="button" aria-label="Fermer le COO" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line-strong bg-surface-0 shadow-2xl">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold text-ink-1">AI COO</p>
                {currentProject ? (
                  <p className="text-[11px] text-ink-4">
                    {currentProject.name}
                    {totalAttention > 0 ? ` · ${totalAttention} à traiter` : ''}
                  </p>
                ) : (
                  <p className="text-[11px] text-ink-4">Aucun projet</p>
                )}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-ink-4 hover:text-ink-1" aria-label="Fermer">
                ✕
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {currentProjectId && thread ? (
                <CooExecutive
                  projectId={currentProjectId}
                  initialMessages={thread}
                  initialObjectives={objectives}
                />
              ) : (
                <p className="p-4 text-[12px] text-ink-4">Créez un projet pour parler au COO.</p>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {/* Bouton flottant */}
      <button
        type="button"
        onClick={openCoo}
        title="Ouvrir le COO (⌘K)"
        className="fixed bottom-5 right-5 z-[55] flex h-13 items-center gap-2 rounded-full border border-line-strong bg-surface-1 px-4 py-3 shadow-xl transition-transform hover:scale-[1.03]"
        style={{ height: '3.25rem' }}
      >
        <span className="text-accent">✦</span>
        <span className="text-[13px] font-medium text-ink-1">COO</span>
        {totalAttention > 0 ? (
          <span className="ml-1 rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold text-white">{totalAttention}</span>
        ) : null}
      </button>
    </>
  );
}
