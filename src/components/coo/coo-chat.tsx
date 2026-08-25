'use client';

import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Mic, MicOff, Send, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/ui';
import { useSpeechInput, useSpeechOutput } from '@/lib/use-voice';
import { Button, IconButton, Notice } from '@/components/ui/primitives';
import type { AssignmentsView } from '@/ai/assignments-view';
import { CooModelPicker } from './coo-model-picker';

type Msg = { id: string; role: 'user' | 'coo'; content: string; mode?: string | null };

const SUGGESTIONS = [
  { label: 'État du projet', prompt: 'Où en sommes-nous ?' },
  { label: 'Ce qui bloque', prompt: "Qu'est-ce qui est bloqué et pourquoi ?" },
  { label: 'Derniers échecs', prompt: 'Quels sont les derniers échecs ?' },
  { label: 'Coût réel', prompt: 'Combien ça a coûté en jetons ?' },
  { label: 'Mémoire', prompt: 'De quoi te souviens-tu sur ce projet ?' },
];

/**
 * COO conversation — single column, built for the global drawer.
 *
 * Your messages sit on the right, the COO's on the left, and the composer is
 * always fully visible. Voice is a click-to-talk toggle (never press-and-hold):
 * the browser's own permission prompt appears on the first click, and every
 * refusal — unsupported browser, blocked mic, no device, no speech — is named
 * with the action that fixes it.
 */
export function CooChat({
  projectId,
  initialMessages,
  assignments,
}: {
  projectId: string;
  initialMessages: Msg[];
  assignments: AssignmentsView | null;
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const voice = useSpeechOutput();
  const [voiceOn, setVoiceOn] = useState(false);

  const input = useSpeechInput({
    interimResults: true,
    onFinal: (text) => {
      void sendWith(text);
    },
    // Live transcript straight into the composer: you see what will be sent.
    onInterim: (text) => {
      if (text) setDraft(text);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, input.interim]);

  async function sendWith(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', content: value }]);
    setDraft('');
    try {
      const res = await fetch(`/api/projects/${projectId}/coo/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: value, autonomyMode: 'autonomous' }),
      });
      const body = (await res.json()) as { message?: { content: string; mode?: string } };
      const content = body.message?.content ?? 'Je n’ai pas pu répondre.';
      setMessages((m) => [...m, { id: `c-${Date.now()}`, role: 'coo', content, mode: body.message?.mode }]);
      if (voiceOn) void voice.speak(content);
    } catch {
      setMessages((m) => [
        ...m,
        { id: `e-${Date.now()}`, role: 'coo', content: 'Le COO est injoignable (erreur réseau ou serveur).' },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const micState = !input.supported
    ? 'unsupported'
    : input.listening
      ? 'listening'
      : input.error
        ? 'error'
        : 'idle';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-accent/30 bg-accent-soft text-accent">
                <Sparkles className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-line bg-surface-1 px-3 py-2.5">
                <p className="text-[13px] leading-relaxed text-ink-1">
                  Je suis votre COO. Donnez-moi un objectif ou posez une question : je planifie, je délègue aux agents,
                  je vérifie et je vous rapporte. Vous pouvez aussi me parler au micro.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 pl-9">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => void sendWith(s.prompt)}
                  className="rounded-full border border-line bg-surface-1 px-2.5 py-1 text-[11.5px] text-ink-3 transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="animate-fade-up flex justify-end">
              <div className="max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3 py-2 text-accent-ink shadow-card">
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{m.content}</p>
              </div>
            </div>
          ) : (
            <div key={m.id} className="animate-fade-up flex items-start gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-ink-3">
                <Sparkles className="size-3.5" />
              </span>
              <div className="min-w-0 max-w-[85%] rounded-xl rounded-tl-sm border border-line bg-surface-1 px-3 py-2.5">
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-1">{m.content}</p>
                {m.mode === 'unavailable' ? (
                  <p className="mt-1.5 text-[10.5px] text-warn">Réponse générée sans modèle · données réelles du projet</p>
                ) : null}
              </div>
            </div>
          ),
        )}

        {busy ? (
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-ink-3">
              <Sparkles className="size-3.5" />
            </span>
            <div className="flex items-center gap-1 rounded-xl border border-line bg-surface-1 px-3 py-3">
              <span className="thinking-dot size-1.5 rounded-full bg-accent" />
              <span className="thinking-dot size-1.5 rounded-full bg-accent" />
              <span className="thinking-dot size-1.5 rounded-full bg-accent" />
              <span className="ml-1.5 text-[11.5px] text-ink-3">Le COO réfléchit et orchestre…</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Composer */}
      <div className="border-t border-line bg-surface-1/60 px-3 pt-2.5 pb-3">
        {input.error ? (
          <Notice
            tone="danger"
            title={input.error.message}
            className="mb-2"
            action={
              <Button size="xs" variant="outline" onClick={() => void input.start()}>
                Réessayer
              </Button>
            }
          >
            {input.error.hint}
          </Notice>
        ) : null}

        {micState === 'unsupported' ? (
          <Notice tone="info" className="mb-2" title="Reconnaissance vocale indisponible">
            Ce navigateur n’expose pas la Web Speech API. Utilisez Chrome ou Edge, ou écrivez simplement votre message.
          </Notice>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendWith(draft);
          }}
          className="rounded-xl border border-line bg-surface-2 transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"
        >
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendWith(draft);
              }
            }}
            rows={2}
            placeholder={input.listening ? 'Je vous écoute…' : 'Écrivez au COO… (Entrée pour envoyer)'}
            className="max-h-32 min-h-[3.25rem] w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] leading-relaxed text-ink-1 placeholder:text-ink-4 focus:outline-none"
          />

          <div className="flex items-center gap-1.5 px-2 pb-2">
            <button
              type="button"
              onClick={() => void input.toggle()}
              disabled={!input.supported}
              aria-pressed={input.listening}
              title={input.listening ? 'Arrêter l’écoute' : 'Parler au COO (clic)'}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors',
                input.listening
                  ? 'animate-mic-ring border-danger/40 bg-danger/12 text-danger'
                  : micState === 'error'
                    ? 'border-danger/30 text-danger hover:bg-danger/10'
                    : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-1 disabled:opacity-40',
              )}
            >
              {input.listening ? <Mic className="size-3.5" /> : micState === 'unsupported' ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
              {input.listening ? 'Écoute…' : 'Parler'}
            </button>

            <IconButton
              label={voiceOn ? 'Couper la lecture vocale' : 'Lire les réponses à voix haute'}
              onClick={() => {
                const next = !voiceOn;
                setVoiceOn(next);
                if (!next) voice.cancel();
              }}
              className={cn('h-8 w-8', voiceOn ? 'border border-ok/35 bg-ok/10 text-ok' : 'border border-line text-ink-3')}
            >
              {voiceOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            </IconButton>

            <div className="ml-auto flex items-center gap-2">
              <CooModelPicker compact initial={assignments} />
              <span className="hidden items-center gap-1 text-[10px] text-ink-4 sm:flex">
                <kbd className="rounded border border-line-strong bg-surface-1 px-1 font-mono">↵</kbd>
                <CornerDownLeft className="size-3" />
              </span>
              <Button type="submit" variant="primary" size="sm" disabled={busy || !draft.trim()} className="h-8">
                <Send className="size-3.5" />
                Envoyer
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
