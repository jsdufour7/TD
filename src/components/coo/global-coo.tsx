'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, Command, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/ui';
import { COO_OPEN_EVENT, type CooOpenDetail } from '@/lib/ui-events';
import { Badge, IconButton, Kbd } from '@/components/ui/primitives';
import type { AssignmentsView } from '@/ai/assignments-view';
import { CooChat } from './coo-chat';
import { GatewayHealthChip } from './coo-model-picker';

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

const STARTERS = [
  'Où en sommes-nous ?',
  "Qu'est-ce qui nécessite mon attention ?",
  'Lance la vérification complète du projet',
  'Résume les derniers échecs et propose une correction',
];

/**
 * Global COO — present on every page, never in the way (§1, §26).
 *
 * Three affordances over one conversation:
 *  - the floating button (bottom-right) with an attention badge,
 *  - ⌘/Ctrl+K, a command bar that sends a natural-language intention,
 *  - the right drawer, which knows the project of the current page and shares
 *    the same persistent thread as /coo and /drive.
 */
export function GlobalCoo({
  projects,
  attention,
  assignments,
}: {
  projects: ProjectRef[];
  attention: Attention;
  assignments: AssignmentsView | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [thread, setThread] = useState<ThreadMessage[] | null>(null);
  const [sending, setSending] = useState(false);
  const cmdRef = useRef<HTMLInputElement | null>(null);

  const totalAttention = attention.approvals + attention.failedRuns + attention.blockedTasks;

  // Projet courant dérivé de l'URL (context awareness), sinon le premier projet.
  const currentProjectId = useMemo(() => {
    const m = /\/projects\/([a-f0-9-]{8,})/.exec(pathname ?? '');
    if (m?.[1] && projects.some((p) => p.id === m[1])) return m[1];
    return projects[0]?.id ?? null;
  }, [pathname, projects]);

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  // ⌘/Ctrl+K → command bar. Escape closes whichever surface is on top.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
        setOpen(false);
        setTimeout(() => cmdRef.current?.focus(), 0);
        return;
      }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Charge le thread du projet courant à l'ouverture du drawer.
  const loadThread = useCallback(async (projectId: string) => {
    try {
      const t = await fetch(`/api/projects/${projectId}/coo/thread`, { cache: 'no-store' }).then((r) => r.json());
      setThread((t.messages ?? []) as ThreadMessage[]);
    } catch {
      setThread([]);
    }
  }, []);

  const openCoo = useCallback(
    (detail?: CooOpenDetail) => {
      setOpen(true);
      setCmdOpen(false);
      if (currentProjectId) void loadThread(currentProjectId);
      if (detail?.prefill) setQuery(detail.prefill);
    },
    [currentProjectId, loadThread],
  );

  // Any surface (sidebar, empty states, page headers) can summon the COO.
  useEffect(() => {
    const handler = (event: Event) => openCoo((event as CustomEvent<CooOpenDetail>).detail);
    window.addEventListener(COO_OPEN_EVENT, handler);
    return () => window.removeEventListener(COO_OPEN_EVENT, handler);
  }, [openCoo]);

  // Command bar → envoie au COO puis ouvre le drawer.
  async function submitCommand(text?: string) {
    const value = (text ?? query).trim();
    if (!value || !currentProjectId) return;
    setQuery('');
    setCmdOpen(false);
    setOpen(true);
    setSending(true);
    try {
      await fetch(`/api/projects/${currentProjectId}/coo/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: value, autonomyMode: 'autonomous' }),
      });
      await loadThread(currentProjectId);
    } catch {
      /* le drawer affichera l'état */
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Command bar (⌘/Ctrl+K) */}
      {cmdOpen ? (
        <div
          className="fixed inset-0 z-[90] flex justify-center bg-black/55 p-4 pt-[10vh] backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label="Commande au COO"
          onClick={() => setCmdOpen(false)}
        >
          <div
            className="animate-pop h-fit w-full max-w-xl overflow-hidden rounded-xl border border-line-strong bg-surface-1 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <form
              className="flex items-center gap-2.5 px-4 py-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                void submitCommand();
              }}
            >
              <Sparkles className="size-4 shrink-0 text-accent" />
              <input
                ref={cmdRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Que doit faire le COO ?"
                className="w-full bg-transparent text-[14px] text-ink-1 placeholder:text-ink-4 outline-none"
              />
              <span className="flex shrink-0 items-center gap-0.5">
                <Kbd>↵</Kbd>
              </span>
            </form>

            <div className="border-t border-line px-2 py-2">
              <p className="px-2 py-1 text-[10px] font-semibold tracking-[0.08em] text-ink-4 uppercase">Suggestions</p>
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void submitCommand(s)}
                  disabled={!currentProjectId}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[12.5px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink-1 disabled:opacity-50"
                >
                  <Command className="size-3.5 shrink-0 text-ink-4" />
                  <span className="flex-1 truncate">{s}</span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-ink-4" />
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-0/40 px-4 py-2 text-[11px] text-ink-4">
              <span className="truncate">
                Contexte : <span className="text-ink-2">{currentProject?.name ?? 'aucun projet'}</span>
                <span className="ml-1.5 font-mono">{pathname}</span>
              </span>
              <span className="hidden shrink-0 items-center gap-0.5 sm:flex">
                <Kbd>esc</Kbd>
                <span className="ml-1">fermer</span>
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Drawer COO */}
      {open ? (
        <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="COO">
          <button
            type="button"
            aria-label="Fermer le COO"
            className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />
          <aside className="animate-slide-in absolute inset-y-0 right-0 flex w-full max-w-[34rem] flex-col border-l border-line-strong bg-surface-0 shadow-pop">
            <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-1/70 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-accent/30 bg-accent-soft text-accent">
                  <Sparkles className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink-1">AI COO</p>
                  <p className="truncate text-[11px] text-ink-4">
                    {currentProject ? currentProject.name : 'Aucun projet'}
                    {totalAttention > 0 ? ` · ${totalAttention} à traiter` : ''}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {totalAttention > 0 ? <Badge tone="warn">{totalAttention}</Badge> : null}
                <GatewayHealthChip view={assignments} />
                <Link
                  href="/coo"
                  title="Ouvrir le COO en pleine page"
                  className="grid size-8 place-items-center rounded-md text-ink-4 transition-colors hover:bg-surface-2 hover:text-ink-1"
                >
                  <ArrowUpRight className="size-4" />
                </Link>
                <IconButton label="Fermer" onClick={() => setOpen(false)}>
                  <X className="size-4" />
                </IconButton>
              </div>
            </header>

            <div className="min-h-0 flex-1">
              {currentProjectId ? (
                <CooChat
                  projectId={currentProjectId}
                  initialMessages={(thread ?? []).map((m) => ({
                    id: m.id,
                    role: m.role === 'user' ? ('user' as const) : ('coo' as const),
                    content: m.content,
                    mode: m.mode,
                  }))}
                  assignments={assignments}
                />
              ) : (
                <div className="p-6">
                  <p className="text-[13px] text-ink-2">Créez un projet pour parler au COO.</p>
                  <Link
                    href="/projects"
                    className="mt-3 inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-accent-ink hover:bg-accent-hover"
                  >
                    Créer un projet
                  </Link>
                </div>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {/* Floating entry point */}
      {!open ? (
        <button
          type="button"
          onClick={() => openCoo()}
          title="Ouvrir le COO (⌘K)"
          className={cn(
            'group fixed right-5 bottom-5 z-[70] flex h-12 items-center gap-2 rounded-full border border-line-strong bg-surface-1 px-4 shadow-pop',
            'transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lift',
            sending && 'opacity-70',
          )}
        >
          <Sparkles className="size-4 text-accent" />
          <span className="text-[13px] font-medium text-ink-1">COO</span>
          {totalAttention > 0 ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white tabular-nums">
              {totalAttention}
            </span>
          ) : null}
        </button>
      ) : null}
    </>
  );
}
