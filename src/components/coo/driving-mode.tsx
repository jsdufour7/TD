'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/ui';

type ChatMessage = { id: string; role: 'user' | 'coo'; content: string };

/**
 * Mode Voiture (Mains Libres) — boucle de dialogue vocale bidirectionnelle.
 *
 * 100 % Web Speech API native (gratuit, local au téléphone) :
 *   - reconnaissance continue fr-FR quand le mode est actif ;
 *   - à la fin de chaque phrase utilisateur : coupe le micro, affiche l'historique,
 *     indique « Le COO réfléchit… », envoie au COO (même thread persistant) ;
 *   - réponse lue avec la voix française + vitesse + tonalité choisies ;
 *   - à la fin de la voix : bip discret (AudioContext) puis relance le micro ;
 *   - « Stop » / « Attends » (ou le bouton rouge) : coupe net la voix et redonne
 *     la parole à l'utilisateur.
 *
 * Anti-écho : le micro est arrêté pendant que le COO parle, relancé après le bip.
 */
export function DrivingMode({ projectId, autonomyMode }: { projectId: string; autonomyMode?: string }) {
  const [modeOn, setModeOn] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Configuration vocale (voix française + vitesse + tonalité).
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [showConfig, setShowConfig] = useState(false);

  const recognitionRef = useRef<{ stop: () => void; abort: () => void; start: () => void } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const modeOnRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    modeOnRef.current = modeOn;
  }, [modeOn]);

  /* ------------------------- Chargement des voix ------------------------- */
  // getVoices() est vide au départ ; on écoute voiceschanged.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const load = () => setVoices(synth.getVoices().filter((v) => v.lang.startsWith('fr')));
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, []);

  /* ------------------------- Auto-scroll historique ---------------------- */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history, thinking]);

  /* ------------------------- Historique persistant ----------------------- */
  // Charge le thread COO existant au montage (persistant côté serveur).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/coo/thread`, { cache: 'no-store' });
        const body = (await res.json()) as { messages?: Array<{ role: string; content: string; id: string }> };
        if (!cancelled && body.messages) {
          setHistory(
            body.messages.map((m) => ({ id: m.id, role: m.role === 'user' ? 'user' : 'coo', content: m.content })),
          );
        }
      } catch {
        /* le thread vide est acceptable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /* ------------------------- Bip discret (AudioContext) ------------------ */
  function beep() {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioCtxRef.current ??= new Ctor();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1600; // haute fréquence, discret
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      /* le bip est un confort, jamais bloquant */
    }
  }

  /* ------------------------- Synthèse vocale ----------------------------- */
  function speak(text: string) {
      const synth = window.speechSynthesis;
      if (!synth) return;
      // Coupe le micro pendant la parole (anti-écho).
      try {
        recognitionRef.current?.stop();
      } catch {
        /* déjà arrêté */
      }
      setListening(false);
      setSpeaking(true);
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      const chosen = voices.find((v) => v.voiceURI === voiceURI);
      if (chosen) utterance.voice = chosen;
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.onend = () => {
        setSpeaking(false);
        beep(); // signal discret « à toi de parler »
        if (modeOnRef.current) startListening(); // redonne la parole, mains libres
      };
      utterance.onerror = () => {
        setSpeaking(false);
        if (modeOnRef.current) startListening();
      };
    synth.speak(utterance);
  }

  /* ------------------------- Reconnaissance vocale ----------------------- */
  function startListening() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError('Reconnaissance vocale indisponible sur ce navigateur (Chrome/Edge requis).');
      return;
    }
    // Évite un double démarrage (InvalidStateError).
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
    }
    const rec = new SR();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => {
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r && r.isFinal) {
          const text = r[0].transcript.trim();
          if (text) void handleUserText(text);
        }
      }
    };
    rec.onend = () => {
      setListening(false);
      // En mode mains libres, relance l'écoute si le COO ne parle pas.
      if (modeOnRef.current && !window.speechSynthesis?.speaking) {
        try {
          rec.start();
          setListening(true);
        } catch {
          /* relance gérée par speak/onend */
        }
      }
    };
    rec.onerror = (e: { error?: string }) => {
      setListening(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Autorisation micro refusée. Activez le micro pour le mode mains libres.');
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      /* déjà démarré */
    }
  }

  /* ------------------------- STOP / urgence ------------------------------ */
  function emergencyStop() {
    window.speechSynthesis?.cancel(); // coupe net la voix + vide la file
    setSpeaking(false);
    setThinking(false);
    // Redonne immédiatement la parole à l'utilisateur.
    if (modeOnRef.current) startListening();
  }

  const isStopWord = (t: string) => /\b(stop|attends|tais-toi|taistoi)\b/i.test(t);

  /* ------------------------- Boucle de dialogue -------------------------- */
  async function handleUserText(text: string) {
    setHistory((h) => [...h, { id: `u-${Date.now()}`, role: 'user', content: text }]);

    if (isStopWord(text)) {
      emergencyStop();
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
      speak(answer);
    } catch {
      setThinking(false);
      setError('Le COO est injoignable.');
    }
  }

  const toggleMode = () => {
    if (modeOn) {
      setModeOn(false);
      modeOnRef.current = false;
      window.speechSynthesis?.cancel();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      setListening(false);
      setSpeaking(false);
    } else {
      setError(null);
      setModeOn(true);
      modeOnRef.current = true;
      startListening();
    }
  };

  return (
    <div className="mx-auto flex h-[88vh] w-full max-w-md flex-col gap-3">
      {/* Configuration vocale (masquable) */}
      <div className="rounded-lg border border-line bg-surface-1">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-2 text-[12px] text-ink-2"
          onClick={() => setShowConfig((v) => !v)}
        >
          <span>Configuration de la voix</span>
          <span className="text-ink-4">{showConfig ? '▲' : '▼'}</span>
        </button>
        {showConfig ? (
          <div className="space-y-3 border-t border-line p-4">
            <label className="block text-[12px] text-ink-2">
              Voix française
              <select className={cn('mt-1 w-full rounded border border-line bg-surface-2 px-2 py-2 text-[13px]')} value={voiceURI} onChange={(e) => setVoiceURI(e.target.value)}>
                <option value="">Par défaut</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] text-ink-2">
              Vitesse : {rate.toFixed(1)}
              <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="w-full" />
            </label>
            <label className="block text-[12px] text-ink-2">
              Tonalité : {pitch.toFixed(1)}
              <input type="range" min={0.5} max={2} step={0.1} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} className="w-full" />
            </label>
            {voices.length === 0 ? <p className="text-[11px] text-warn">Aucune voix française détectée sur cet appareil.</p> : null}
          </div>
        ) : null}
      </div>

      {/* Historique (auto-scroll) */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-line bg-surface-1 p-3">
        {history.length === 0 ? <p className="p-2 text-[12px] text-ink-4">L’historique de la conversation apparaîtra ici.</p> : null}
        {history.map((m) => (
          <div key={m.id} className={cn('max-w-[85%] rounded-lg px-3 py-2 text-[13px]', m.role === 'user' ? 'ml-auto bg-accent/15' : 'bg-surface-2')}>
            <p className="mb-0.5 text-[10px] font-medium uppercase text-ink-4">{m.role === 'user' ? 'Vous' : 'COO'}</p>
            <p className="whitespace-pre-wrap text-ink-1">{m.content}</p>
          </div>
        ))}
        {thinking ? (
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-accent">Le COO réfléchit et orchestre…</div>
        ) : null}
        {error ? <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div> : null}
      </div>

      {/* Indicateur d'état */}
      <div className="flex items-center justify-center gap-3 text-[12px]">
        <span className={cn(listening ? 'text-ok' : 'text-ink-4')}>{listening ? '🎙 Micro ouvert' : ''}</span>
        <span className={cn(speaking ? 'text-accent' : 'text-ink-4')}>{speaking ? '🔊 COO parle' : ''}</span>
      </div>

      {/* Boutons géants */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={toggleMode}
          className={cn(
            'h-20 rounded-2xl text-lg font-semibold',
            modeOn ? 'bg-ok/20 text-ok ring-2 ring-ok/40' : 'bg-accent text-accent-ink',
          )}
        >
          {modeOn ? 'Mode Voiture : ON' : 'Mode Voiture (Mains Libres)'}
        </button>
        <button type="button" onClick={emergencyStop} className="h-20 rounded-2xl bg-danger text-lg font-semibold text-white">
          STOP / INTERROMPRE
        </button>
      </div>
    </div>
  );
}
