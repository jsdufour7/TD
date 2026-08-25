'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, EmptyState, inputClass } from '@/components/ui/primitives';
import { cn } from '@/lib/ui';

type CooMessage = {
  id: string;
  role: string;
  authorName: string | null;
  content: string;
  mode: string | null;
  runId: string | null;
  createdAt: string;
};
type Objective = {
  id: string;
  title: string;
  status: string;
  autonomyMode: string;
};

const MODES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'manual', label: 'Manual', hint: 'conseille seulement' },
  { value: 'approval', label: 'Approval', hint: 'plan puis approbation' },
  { value: 'autonomous', label: 'Autonomous', hint: 'exécute dans les permissions' },
  { value: 'mission', label: 'Mission', hint: 'jusqu’à succès ou blocage' },
];

const OBJ_TONE: Record<string, string> = {
  active: 'accent',
  planning: 'info',
  completed: 'ok',
  failed: 'danger',
  blocked: 'warn',
  paused: 'warn',
  awaiting_user: 'warn',
  draft: 'idle',
  cancelled: 'idle',
};

/**
 * The COO as the primary interface: write a high-level directive and the COO
 * understands, plans, creates tasks, picks agents and executes — or answers a
 * question. Autonomy is selectable; provenance is always shown.
 */
export function CooExecutive({
  projectId,
  initialMessages,
  initialObjectives,
}: {
  projectId: string;
  initialMessages: CooMessage[];
  initialObjectives: Objective[];
}) {
  const [messages, setMessages] = useState<CooMessage[]>(initialMessages);
  const [objectives, setObjectives] = useState<Objective[]>(initialObjectives);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState('autonomous');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const lastExecuted = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m && m.mode === 'executed') return m;
    }
    return null;
  }, [messages]);

  const [voiceOn, setVoiceOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [tts, setTts] = useState<'browser' | 'local' | 'cloud'>('browser');
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /**
   * Speak a COO reply. Provider order: the selected engine, then the browser.
   * `local`/`cloud` go through /api/voice/synthesize (Kokoro/Piper or a configured
   * cloud provider); if that engine isn't configured we fall back to the free
   * browser voice rather than staying silent.
   */
  async function speak(text: string) {
    if (!voiceOn || !text) return;
    stopSpeaking();
    if (tts !== 'browser') {
      try {
        const res = await fetch('/api/voice/synthesize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: text.slice(0, 2000) }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          audioRef.current = new Audio(url);
          audioRef.current.play().catch(() => speakBrowser(text));
          return;
        }
      } catch {
        /* fall through to browser */
      }
    }
    speakBrowser(text);
  }

  /** Improved browser fallback: pick the best available French voice. */
  function speakBrowser(text: string) {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      const voices = synth.getVoices();
      const preferred =
        voices.find((v) => /fr(-|_)?(CA|FR|QC)/i.test(v.lang) && /google|amelie|thomas|natural|neural/i.test(v.name)) ??
        voices.find((v) => /fr(-|_)?(CA|FR|QC)/i.test(v.lang)) ??
        voices.find((v) => v.lang.startsWith('fr'));
      if (preferred) utterance.voice = preferred;
      utterance.rate = 1.02;
      utterance.pitch = 1;
      synth.cancel();
      synth.speak(utterance);
    } catch {
      /* voice is an enhancement; never break the loop */
    }
  }

  function stopSpeaking() {
    try {
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
  }

  /**
   * Push-to-talk. The transcript goes to the SAME COO thread as text — there is
   * no separate voice assistant. If no recognition engine exists, report it.
   */
  function startListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError('Reconnaissance vocale indisponible dans ce navigateur. Tapez, ou configurez un STT local (VOICE_STT_URL).');
      return;
    }
    const rec = new SR();
    rec.lang = 'fr-CA';
    rec.interimResults = false;
    rec.onresult = (e: { results: Array<Array<{ transcript: string }>> }) => {
      const transcript = e.results[0]?.[0]?.transcript ?? '';
      setListening(false);
      if (transcript) void sendWith(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function send() {
    await sendWith(draft);
  }

  async function sendWith(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    const userMsg: CooMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      authorName: null,
      content: text.trim(),
      mode: null,
      runId: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    setDraft('');
    try {
      const res = await fetch(`/api/projects/${projectId}/coo/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text.trim(), autonomyMode: mode }),
      });
      const body = (await res.json()) as {
        message?: CooMessage;
        result?: { kind: string; runId?: string };
        error?: { message?: string };
      };
      if (res.ok && body.message) {
        setMessages((m) => [...m, { ...body.message!, runId: body.result?.runId ?? null }]);
        speak(body.message.content ?? '');
        // Refresh objectives so newly created ones appear.
        const o = await fetch(`/api/projects/${projectId}/objectives`, { cache: 'no-store' });
        const ob = (await o.json()) as { objectives?: Objective[] };
        if (ob.objectives) setObjectives(ob.objectives);
      } else {
        setError(body.error?.message ?? 'The COO could not respond');
        setMessages((m) => m.filter((x) => x.id !== userMsg.id));
      }
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
      {/* Conversation */}
      <section className="flex h-[62vh] min-h-96 flex-col rounded-lg border border-line bg-surface-1">
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-ok animate-pulse-dot" aria-hidden="true" />
            <h2 className="text-[13px] font-medium">AI COO</h2>
            <span className="text-[10.5px] text-ink-4">comprend → planifie → exécute → vérifie → rapporte</span>
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <EmptyState
              compact
              title="Parlez à votre COO"
              description="Ex. « Termine la V1 », « Analyse le projet et avance sur la priorité », « Où en sommes-nous ? ». Le COO ne vous demandera de décider que si c’est réellement nécessaire."
            />
          ) : (
            messages.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[88%] rounded-lg px-3 py-2', m.role === 'user' ? 'bg-accent/15' : 'bg-surface-2')}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[11px] font-medium">{m.authorName ?? 'Vous'}</span>
                    {m.mode ? <Badge tone={m.mode === 'executed' ? 'accent' : m.mode === 'model' ? 'ok' : 'info'}>{m.mode}</Badge> : null}
                  </div>
                  <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-1">{m.content}</p>
                  {m.runId ? (
                    <Link href={`/projects/${projectId}/runs/${m.runId}`} className="mt-1 inline-block text-[11px] text-accent hover:underline">
                      voir le run →
                    </Link>
                  ) : null}
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
          className="space-y-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            className={cn(inputClass, 'min-h-16 resize-y')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Donnez un objectif haut niveau au COO… (Entrée pour envoyer)"
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <select className={cn(inputClass, 'w-auto')} value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode d'autonomie">
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="hidden text-[10.5px] text-ink-4 sm:inline">{MODES.find((m) => m.value === mode)?.hint}</span>
            <div className="ml-auto flex items-center gap-1.5">
              <select
                value={tts}
                onChange={(e) => setTts(e.target.value as 'browser' | 'local' | 'cloud')}
                title="Moteur de voix : Navigateur (gratuit) · Local (Kokoro/Piper) · Cloud (OpenAI/ElevenLabs)"
                className={cn(inputClass, 'w-auto py-1 text-[11px]')}
              >
                <option value="browser">Voix navigateur</option>
                <option value="local">Kokoro/Piper local</option>
                <option value="cloud">Cloud (OpenAI/ElevenLabs)</option>
              </select>
              <button
                type="button"
                title={voiceOn ? 'Couper la lecture vocale' : 'Lire les réponses à voix haute'}
                onClick={() => setVoiceOn((v) => !v)}
                className={cn('rounded border px-2 py-1 text-[12px]', voiceOn ? 'border-ok/40 bg-ok/10 text-ok' : 'border-line text-ink-4')}
              >
                🔊
              </button>
              <button
                type="button"
                title="Push-to-talk : maintenez pour parler, relâchez pour envoyer"
                onPointerDown={(e) => {
                  e.preventDefault();
                  startListening();
                }}
                onPointerUp={() => recognitionRef.current?.stop()}
                onPointerLeave={() => listening && recognitionRef.current?.stop()}
                onKeyDown={(e) => {
                  if (e.key === ' ' && !listening) {
                    e.preventDefault();
                    startListening();
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === ' ') recognitionRef.current?.stop();
                }}
                className={cn(
                  'rounded border px-2 py-1 text-[12px] select-none',
                  listening ? 'border-danger/40 bg-danger/10 text-danger animate-pulse' : 'border-line text-ink-4',
                )}
              >
                🎙 {listening ? 'Je vous écoute…' : ''}
              </button>
              <Button type="submit" variant="primary" loading={busy} disabled={!draft.trim()}>
                Confier au COO
              </Button>
            </div>
          </div>
        </form>
      </section>

      {/* Objectives / live ops */}
      <aside className="space-y-4">
        <section className="rounded-lg border border-line bg-surface-1">
          <header className="border-b border-line px-3 py-2">
            <h3 className="text-[12px] font-medium">Objectives</h3>
          </header>
          <ul className="max-h-72 space-y-1 overflow-y-auto p-2">
            {objectives.length === 0 ? (
              <li className="p-2 text-[11px] text-ink-4">Aucun objective. Le COO en crée depuis vos directives.</li>
            ) : (
              objectives.map((o) => (
                <li key={o.id} className="rounded border border-line bg-surface-2 p-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={OBJ_TONE[o.status] ?? 'idle'}>{o.status}</Badge>
                    <span className="text-[10px] text-ink-4">{o.autonomyMode}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11.5px] text-ink-1">{o.title}</p>
                </li>
              ))
            )}
          </ul>
        </section>

        {lastExecuted ? (
          <section className="rounded-lg border border-line bg-surface-1 p-3">
            <h3 className="text-[12px] font-medium">Dernière exécution</h3>
            <p className="mt-1 whitespace-pre-wrap text-[11px] text-ink-3">{lastExecuted.content}</p>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
