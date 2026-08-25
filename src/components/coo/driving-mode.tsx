'use client';

import { useEffect, useRef, useState } from 'react';
import { Car, Mic, Settings2, Sparkles, Square } from 'lucide-react';
import { cn } from '@/lib/ui';
import { playCue, useSpeechInput, useSpeechOutput } from '@/lib/use-voice';
import { Badge, Button, Notice } from '@/components/ui/primitives';

type ChatMessage = { id: string; role: 'user' | 'coo'; content: string };

/**
 * Mode Voiture (Mains Libres) — boucle de dialogue vocal bidirectionnel.
 *
 * 100 % Web Speech API native (gratuit, local au téléphone) :
 *   - reconnaissance continue fr-FR tant que le mode est actif ;
 *   - à chaque phrase finale : micro coupé, historique affiché, « Le COO
 *     réfléchit… », envoi au COO (même thread persistant que le drawer) ;
 *   - réponse lue avec la voix française, la vitesse et la tonalité choisies ;
 *   - fin de la voix → bip discret puis le micro revient (anti-écho) ;
 *   - « Stop » / « Attends » (ou le bouton rouge) coupe net et vous redonne la
 *     parole.
 *
 * Chaque refus du micro est nommé (navigateur, permission, appareil, silence) —
 * jamais un bouton qui ne fait rien.
 */
export function DrivingMode({ projectId, autonomyMode }: { projectId: string; autonomyMode?: string }) {
  const [modeOn, setModeOn] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const voice = useSpeechOutput();
  const modeOnRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const input = useSpeechInput({
    lang: 'fr-FR',
    continuous: true,
    interimResults: false,
    autoRestart: true,
    onFinal: (text) => void handleUserText(text),
  });

  useEffect(() => {
    modeOnRef.current = modeOn;
  }, [modeOn]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history, thinking, input.interim]);

  // Historique persistant : le thread COO du projet, partagé avec le drawer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/coo/thread`, { cache: 'no-store' });
        const body = (await res.json()) as { messages?: Array<{ role: string; content: string; id: string }> };
        if (!cancelled && body.messages) {
          setHistory(body.messages.map((m) => ({ id: m.id, role: m.role === 'user' ? 'user' : 'coo', content: m.content })));
        }
      } catch {
        /* un thread vide est acceptable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function speakAnswer(text: string) {
    // Coupe le micro pendant la parole (anti-écho).
    input.stop();
    await voice.speak(text);
    playCue('ready');
    if (modeOnRef.current) await input.start();
  }

  const isStopWord = (t: string) => /\b(stop|attends|tais-toi|taistoi)\b/i.test(t);

  async function handleUserText(text: string) {
    setHistory((h) => [...h, { id: `u-${Date.now()}`, role: 'user', content: text }]);

    if (isStopWord(text)) {
      voice.cancel();
      setThinking(false);
      if (modeOnRef.current) await input.start();
      return;
    }

    setThinking(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/coo/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text, autonomyMode: autonomyMode ?? 'autonomous' }),
      });
      const body = (await res.json()) as { message?: { content: string } };
      const answer = body.message?.content ?? 'Je n’ai pas pu répondre.';
      setHistory((h) => [...h, { id: `c-${Date.now()}`, role: 'coo', content: answer }]);
      setThinking(false);
      await speakAnswer(answer);
    } catch {
      setThinking(false);
      setFatal('Le COO est injoignable.');
    }
  }

  async function toggleMode() {
    if (modeOn) {
      setModeOn(false);
      modeOnRef.current = false;
      voice.cancel();
      input.stop();
      return;
    }
    setFatal(null);
    setModeOn(true);
    modeOnRef.current = true;
    await input.start();
  }

  function emergencyStop() {
    voice.cancel();
    setThinking(false);
    playCue('stop');
    if (modeOnRef.current) void input.start();
    else input.stop();
  }

  return (
    <div className="mx-auto flex h-[88vh] w-full max-w-md flex-col gap-3">
      {/* Configuration vocale */}
      <div className="rounded-lg border border-line bg-surface-1 shadow-card">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-2.5 text-[12px] text-ink-2 transition-colors hover:text-ink-1"
          onClick={() => setShowConfig((v) => !v)}
        >
          <span className="flex items-center gap-2">
            <Settings2 className="size-3.5 text-ink-4" />
            Configuration de la voix
          </span>
          <span className="text-ink-4">{showConfig ? '▲' : '▼'}</span>
        </button>
        {showConfig ? (
          <div className="space-y-3 border-t border-line p-4">
            <label className="block text-[12px] text-ink-2">
              Voix française
              <select
                className="mt-1 w-full rounded-md border border-line bg-surface-2 px-2 py-2 text-[13px] text-ink-1"
                value={voice.settings.voiceURI}
                onChange={(e) => voice.update({ voiceURI: e.target.value })}
              >
                <option value="">Par défaut</option>
                {voice.voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] text-ink-2">
              Vitesse : {voice.settings.rate.toFixed(1)}
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={voice.settings.rate}
                onChange={(e) => voice.update({ rate: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="block text-[12px] text-ink-2">
              Tonalité : {voice.settings.pitch.toFixed(1)}
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={voice.settings.pitch}
                onChange={(e) => voice.update({ pitch: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            {voice.voices.length === 0 ? (
              <Notice tone="warn">Aucune voix française détectée sur cet appareil.</Notice>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Historique */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-line bg-surface-1 p-3 shadow-card">
        {history.length === 0 ? (
          <p className="p-2 text-[12px] text-ink-4">L’historique de la conversation apparaîtra ici.</p>
        ) : null}
        {history.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3 py-2 text-accent-ink">
              <p className="mb-0.5 text-[10px] font-medium uppercase opacity-80">Vous</p>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{m.content}</p>
            </div>
          ) : (
            <div key={m.id} className="flex items-start gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-ink-3">
                <Sparkles className="size-3" />
              </span>
              <div className="max-w-[85%] rounded-xl rounded-tl-sm border border-line bg-surface-2 px-3 py-2">
                <p className="mb-0.5 text-[10px] font-medium uppercase text-ink-4">COO</p>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-1">{m.content}</p>
              </div>
            </div>
          ),
        )}
        {thinking ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-accent">
            <span className="thinking-dot size-1.5 rounded-full bg-accent" />
            <span className="thinking-dot size-1.5 rounded-full bg-accent" />
            <span className="thinking-dot size-1.5 rounded-full bg-accent" />
            <span className="ml-1">Le COO réfléchit et orchestre…</span>
          </div>
        ) : null}
        {input.interim ? (
          <div className="ml-auto max-w-[85%] rounded-xl border border-dashed border-accent/40 bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
            {input.interim}
          </div>
        ) : null}
        {input.error ? <Notice tone="danger" title={input.error.message}>{input.error.hint}</Notice> : null}
        {fatal ? <Notice tone="danger" title={fatal} /> : null}
      </div>

      {/* État */}
      <div className="flex items-center justify-center gap-2">
        {input.listening ? (
          <Badge tone="danger" dot>
            <Mic className="size-3" /> micro ouvert
          </Badge>
        ) : null}
        {voice.speaking ? (
          <Badge tone="accent" dot>
            le COO parle
          </Badge>
        ) : null}
        {!input.listening && !voice.speaking ? (
          <Badge tone="idle">{modeOn ? 'en pause' : 'mode inactif'}</Badge>
        ) : null}
      </div>

      {/* Boutons géants (cibles tactiles ≥ 56px) */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => void toggleMode()}
          className={cn(
            'flex h-20 items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold transition-colors',
            modeOn ? 'border-2 border-ok/40 bg-ok/15 text-ok' : 'bg-accent text-accent-ink hover:bg-accent-hover',
          )}
        >
          {modeOn ? <Mic className="size-5" /> : <Car className="size-5" />}
          {modeOn ? 'Mode Voiture : ON' : 'Mode Voiture'}
        </button>
        <button
          type="button"
          onClick={emergencyStop}
          className="flex h-20 items-center justify-center gap-2 rounded-2xl bg-danger text-[15px] font-semibold text-white transition-transform active:scale-[0.98]"
        >
          <Square className="size-4 fill-current" />
          STOP
        </button>
      </div>

      <Button variant="ghost" size="sm" className="mx-auto" onClick={() => void toggleMode()}>
        {modeOn ? 'Désactiver le mode mains libres' : 'Activer le mode mains libres'}
      </Button>
    </div>
  );
}
