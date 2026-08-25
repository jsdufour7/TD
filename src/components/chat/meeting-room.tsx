'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Field, inputClass } from '@/components/ui/primitives';
import { cn } from '@/lib/ui';

type Thread = { id: string; title: string; participants: string[]; updatedAt: string };
type Message = {
  id: string;
  role: string;
  authorName: string | null;
  agentKey: string | null;
  mode: string | null;
  content: string;
  createdAt: string;
};
type AgentInfo = { key: string; name: string; role: string; accentColor: string };

const MODE_LABEL: Record<string, { label: string; tone: string }> = {
  model: { label: 'modèle', tone: 'ok' },
  deterministic: { label: 'données réelles', tone: 'info' },
  unavailable: { label: 'hors-ligne', tone: 'warn' },
};

/**
 * Meeting room / chat with the COO.
 *
 * A thread with no participants is a one-on-one with the COO; with participants,
 * every convened agent answers in role and sees the prior contributions, so the
 * discussion builds. Message provenance is shown: "modèle", "données réelles" or
 * "hors-ligne" — the app never hides which mode produced an answer.
 */
export function MeetingRoom({
  projectId,
  agents,
  initialThreads,
  initialMessages,
  selfName,
}: {
  projectId: string;
  agents: AgentInfo[];
  initialThreads: Thread[];
  initialMessages: Message[];
  selfName: string;
}) {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [activeId, setActiveId] = useState<string | null>(initialThreads[0]?.id ?? null);
  // Messages are cached per thread and loaded in event handlers (never in an
  // effect), so the strict no-setState-in-effect rule is respected and switching
  // back to a thread is instant.
  const [messagesByThread, setMessagesByThread] = useState<Record<string, Message[]>>(() =>
    initialThreads[0] ? { [initialThreads[0].id]: initialMessages } : {},
  );
  const messages = useMemo(
    () => (activeId ? (messagesByThread[activeId] ?? []) : []),
    [activeId, messagesByThread],
  );
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newParticipants, setNewParticipants] = useState<string[]>(['coo']);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const active = threads.find((t) => t.id === activeId) ?? null;

  async function selectThread(id: string) {
    setActiveId(id);
    // Fetch on demand and cache; the initial thread's messages came from the server.
    setMessagesByThread((cache) => {
      if (cache[id]) return cache;
      void (async () => {
        const res = await fetch(`/api/projects/${projectId}/conversations/${id}`, { cache: 'no-store' });
        const body = (await res.json()) as { messages?: Message[] };
        if (body.messages) setMessagesByThread((c) => ({ ...c, [id]: body.messages! }));
      })();
      return { ...cache, [id]: [] };
    });
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function createThread() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: newTitle || undefined, participants: newParticipants }),
      });
      const body = (await res.json()) as { conversation?: Thread };
      if (res.ok && body.conversation) {
        setThreads((t) => [body.conversation!, ...t]);
        setMessagesByThread((c) => ({ ...c, [body.conversation!.id]: [] }));
        setActiveId(body.conversation.id);
        setComposing(false);
        setNewTitle('');
      }
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!activeId || !draft.trim()) return;
    setBusy(true);
    setError(null);
    const userMessage: Message = {
      id: `local-${Date.now()}`,
      role: 'user',
      authorName: selfName,
      agentKey: null,
      mode: null,
      content: draft.trim(),
      createdAt: new Date().toISOString(),
    };
    setMessagesByThread((c) => ({ ...c, [activeId]: [...(c[activeId] ?? []), userMessage] }));
    setDraft('');
    try {
      const res = await fetch(`/api/projects/${projectId}/conversations/${activeId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: userMessage.content }),
      });
      const body = (await res.json()) as { messages?: Message[]; error?: { message?: string } };
      if (res.ok && body.messages) {
        setMessagesByThread((c) => ({ ...c, [activeId]: [...(c[activeId] ?? []), ...body.messages!] }));
      } else {
        setError(body.error?.message ?? 'Could not get a reply');
        setMessagesByThread((c) => ({ ...c, [activeId]: (c[activeId] ?? []).filter((x) => x.id !== userMessage.id) }));
      }
    } finally {
      setBusy(false);
    }
  }

  const agentByKey = new Map(agents.map((a) => [a.key, a]));

  return (
    <div className="grid h-[calc(100dvh-14rem)] min-h-96 gap-4 lg:grid-cols-[16rem_1fr]">
      {/* Thread list / new meeting */}
      <aside className="flex min-h-0 flex-col rounded-lg border border-line bg-surface-1">
        <header className="flex items-center justify-between border-b border-line px-3 py-2">
          <h2 className="text-[12px] font-medium">Discussions</h2>
          <Button size="xs" variant="primary" onClick={() => setComposing((v) => !v)}>
            + Réunion
          </Button>
        </header>

        {composing ? (
          <div className="space-y-3 border-b border-line p-3">
            <Field label="Sujet">
              <input className={inputClass} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Comprendre l'architecture d'auth" />
            </Field>
            <div>
              <p className="mb-1 text-[11px] text-ink-3">Convoquer</p>
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {agents.map((agent) => {
                  const on = newParticipants.includes(agent.key);
                  return (
                    <label key={agent.key} className="flex items-center gap-2 text-[11.5px] text-ink-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setNewParticipants((p) => (on ? p.filter((k) => k !== agent.key) : [...p, agent.key]))
                        }
                      />
                      {agent.name}
                      <span className="text-[10px] text-ink-4">{agent.role}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <Button size="sm" variant="primary" loading={busy} onClick={() => void createThread()}>
              Ouvrir la salle
            </Button>
          </div>
        ) : null}

        <ul className="min-h-0 flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <li className="p-3">
              <EmptyState compact title="Aucune discussion" description="Ouvrez une réunion ou un tête-à-tête avec le COO." />
            </li>
          ) : (
            threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => void selectThread(thread.id)}
                  className={cn(
                    'block w-full px-3 py-2 text-left text-[12px] transition-colors',
                    activeId === thread.id ? 'bg-surface-3 text-ink-1' : 'text-ink-2 hover:bg-surface-2',
                  )}
                >
                  <span className="block truncate">{thread.title}</span>
                  <span className="text-[10px] text-ink-4">
                    {thread.participants.length > 0 ? `${thread.participants.length} agent(s)` : 'COO'}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      {/* Messages + composer */}
      <section className="flex min-h-0 flex-col rounded-lg border border-line bg-surface-1">
        <header className="border-b border-line px-4 py-2">
          <h2 className="truncate text-[13px] font-medium">{active?.title ?? 'Sélectionnez ou créez une discussion'}</h2>
          {active ? (
            <p className="text-[10.5px] text-ink-4">
              {active.participants.length > 0
                ? active.participants.map((k) => agentByKey.get(k)?.name ?? k).join(' · ')
                : 'AI COO'}
            </p>
          ) : null}
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <EmptyState
              compact
              title="Commencez la discussion"
              description="Posez une question au COO, ou convoquez plusieurs agents pour une réunion. Sans passerelle modèle, le COO répond à partir des données réelles du projet."
            />
          ) : (
            messages.map((message) => (
              <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg px-3 py-2',
                    message.role === 'user' ? 'bg-accent/15 text-ink-1' : 'bg-surface-2 text-ink-1',
                  )}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[11px] font-medium">{message.authorName ?? (message.role === 'user' ? selfName : 'Agent')}</span>
                    {message.mode ? (
                      <Badge tone={MODE_LABEL[message.mode]?.tone ?? 'idle'}>
                        {MODE_LABEL[message.mode]?.label ?? message.mode}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed">{message.content}</p>
                </div>
              </div>
            ))
          )}
          {error ? (
            <p role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <form
          className="flex gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            className={inputClass}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Écrivez au COO ou à la salle… (état, échecs, bloqué, coût, mémoire)"
            disabled={!activeId || busy}
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!activeId || !draft.trim()}>
            Envoyer
          </Button>
        </form>
      </section>
    </div>
  );
}

