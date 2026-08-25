'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/ui';

type Msg = { id: string; role: 'user' | 'coo'; content: string; mode?: string | null };

/**
 * Chat COO compact, une seule colonne, conçu pour le drawer global.
 * Vos messages (à droite, accentués) et ceux du COO (à gauche) sont toujours
 * visibles ; saisie avec Entrée, micro push-to-talk, lecture vocale optionnelle.
 */
export function CooChat({ projectId, initialMessages }: { projectId: string; initialMessages: Msg[] }) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recRef = useRef<{ stop: () => void; abort: () => void } | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  function speak(text: string) {
    if (!voiceOn) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      const fr = synth.getVoices().find((v) => v.lang.startsWith('fr'));
      if (fr) u.voice = fr;
      u.rate = 1.02;
      synth.cancel();
      synth.speak(u);
    } catch {
      /* confort, jamais bloquant */
    }
  }

  function startListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    try {
      recRef.current?.abort();
    } catch {
      /* ignore */
    }
    const rec = new SR();
    rec.lang = 'fr-FR';
    rec.interimResults = false;
    rec.onresult = (e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => {
      const t = e.results[0]?.[0]?.transcript?.trim();
      setListening(false);
      if (t) void sendWith(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function sendWith(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', content: text.trim() }]);
    setDraft('');
    try {
      const res = await fetch(`/api/projects/${projectId}/coo/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text.trim(), autonomyMode: 'autonomous' }),
      });
      const body = (await res.json()) as { message?: { content: string; mode?: string } };
      const content = body.message?.content ?? 'Je n’ai pas pu répondre.';
      setMessages((m) => [...m, { id: `c-${Date.now()}`, role: 'coo', content, mode: body.message?.mode }]);
      speak(content);
    } catch {
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: 'coo', content: 'Le COO est injoignable.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-[12px] text-ink-4">Posez une question ou donnez un objectif au COO.</p>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[85%] rounded-xl px-3 py-2', m.role === 'user' ? 'bg-accent/20' : 'bg-surface-2')}>
              <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-4">
                {m.role === 'user' ? 'Vous' : 'COO'}
              </p>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-1">{m.content}</p>
            </div>
          </div>
        ))}
        {busy ? <p className="text-[12px] text-accent">Le COO réfléchit…</p> : null}
      </div>

      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void sendWith(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendWith(draft);
            }
          }}
          rows={2}
          placeholder="Écrivez au COO… (Entrée pour envoyer)"
          className="max-h-32 min-h-10 w-full flex-1 resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-1 focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
        />
        <button
          type="button"
          title="Parler (push-to-talk)"
          onPointerDown={() => startListening()}
          onPointerUp={() => recRef.current?.stop()}
          className={cn('h-10 w-10 shrink-0 rounded-lg border text-[14px]', listening ? 'border-danger/40 bg-danger/10 text-danger' : 'border-line text-ink-3')}
        >
          🎙
        </button>
        <button
          type="button"
          title={voiceOn ? 'Couper la voix' : 'Lire les réponses'}
          onClick={() => setVoiceOn((v) => !v)}
          className={cn('h-10 w-10 shrink-0 rounded-lg border text-[14px]', voiceOn ? 'border-ok/40 bg-ok/10 text-ok' : 'border-line text-ink-3')}
        >
          🔊
        </button>
        <button type="submit" disabled={busy || !draft.trim()} className="h-10 shrink-0 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink disabled:opacity-40">
          ➤
        </button>
      </form>
    </div>
  );
}
