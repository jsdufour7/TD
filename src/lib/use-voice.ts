'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, useState } from 'react';
import { useStoredString } from './use-stored';

const noopSubscribe = () => () => {};

/**
 * Browser voice primitives — one implementation, used by the COO drawer, the
 * chat and Mode Voiture.
 *
 * Two rules drive the design:
 *  1. Never fail silently. Every reason the microphone can refuse (unsupported
 *     browser, insecure context, permission denied, no device, no speech,
 *     network) is surfaced as a French message plus the action that fixes it.
 *  2. Click, don't hold. Push-to-talk on a pointerdown/pointerup pair swallows
 *     ordinary clicks, so these hooks are explicit start/stop toggles.
 */

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

export type VoiceError = { code: string; message: string; hint?: string };

const ERROR_COPY: Record<string, { message: string; hint?: string }> = {
  'not-allowed': {
    message: 'Le micro est refusé par le navigateur.',
    hint: 'Cliquez sur l’icône de cadenas (ou d’information) dans la barre d’adresse, autorisez le microphone, puis rechargez la page.',
  },
  'service-not-allowed': {
    message: 'Le service de reconnaissance vocale est bloqué.',
    hint: 'Vérifiez les permissions du site et que la page est servie en HTTPS.',
  },
  'audio-capture': {
    message: 'Aucun microphone utilisable.',
    hint: 'Branchez un micro (ou vérifiez qu’aucune autre application ne l’accapare), puis réessayez.',
  },
  'no-speech': {
    message: 'Je n’ai rien entendu.',
    hint: 'Cliquez à nouveau sur le micro et parlez normalement, près de l’appareil.',
  },
  network: {
    message: 'La reconnaissance vocale du navigateur n’a pas pu joindre son service.',
    hint: 'Le Web Speech API de Chrome envoie l’audio aux serveurs Google : une connexion est nécessaire.',
  },
  'language-not-supported': {
    message: 'Ce navigateur ne reconnaît pas le français.',
    hint: 'Utilisez Chrome ou Edge, ou écrivez votre message.',
  },
  aborted: { message: 'Écoute interrompue.' },
};

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Probe the microphone so a permission refusal is named, not guessed. */
async function probeMicrophone(): Promise<VoiceError | null> {
  if (typeof navigator === 'undefined') return null;
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) {
    return {
      code: 'unsupported-context',
      message: 'Le micro n’est pas accessible dans ce contexte.',
      hint: 'Ouvrez la page dans un onglet dédié (HTTPS ou localhost) : un cadre intégré peut bloquer le micro.',
    };
  }
  try {
    const stream = await devices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return null;
  } catch (error) {
    const name = error instanceof DOMException ? error.name : String(error);
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      const copy = ERROR_COPY['not-allowed'];
      return { code: name, message: copy?.message ?? 'Micro refusé.', hint: copy?.hint };
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      const copy = ERROR_COPY['audio-capture'];
      return { code: name, message: copy?.message ?? 'Aucun microphone.', hint: copy?.hint };
    }
    return {
      code: name,
      message: 'Le microphone n’a pas pu être ouvert.',
      hint: name,
    };
  }
}

export function useSpeechInput(options: {
  onFinal: (text: string) => void;
  /** Live partial transcript, straight from the recognition event. */
  onInterim?: (text: string) => void;
  lang?: string;
  interimResults?: boolean;
  continuous?: boolean;
  /** Relaunch listening automatically after each utterance (hands-free loop). */
  autoRestart?: boolean;
}) {
  const { onFinal, onInterim, lang = 'fr-FR', interimResults = true, continuous = false, autoRestart = false } = options;

  // Capability is an external fact about the browser, read through
  // useSyncExternalStore so the server render and the first client render agree.
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => recognitionCtor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<VoiceError | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  const autoRestartRef = useRef(autoRestart);
  const wantedRef = useRef(false);

  // "Latest callback" refs: the recognition instance lives across renders, so it
  // reads the current handlers through a ref instead of closing over stale ones.
  useEffect(() => {
    onFinalRef.current = onFinal;
    onInterimRef.current = onInterim;
    autoRestartRef.current = autoRestart;
  });

  // Stop any in-flight recognition when the component unmounts.
  useEffect(
    () => () => {
      wantedRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* already stopped */
      }
    },
    [],
  );

  const stop = useCallback(() => {
    wantedRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(async () => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError({
        code: 'unsupported',
        message: 'Ce navigateur n’a pas de reconnaissance vocale.',
        hint: 'Chrome, Edge ou Safari sont requis. Vous pouvez aussi écrire votre message.',
      });
      return;
    }

    setError(null);

    // Ask for the microphone first: it triggers the browser's own permission
    // prompt and tells us precisely why it was refused, instead of surfacing a
    // bare "aborted" from the recognition engine.
    const permission = await probeMicrophone();
    if (permission) {
      setError(permission);
      return;
    }

    try {
      recRef.current?.abort();
    } catch {
      /* ignore */
    }

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = interimResults;
    rec.maxAlternatives = 1;
    recRef.current = rec;
    wantedRef.current = true;

    rec.onresult = (event) => {
      let finalText = '';
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finalText += transcript;
        else partial += transcript;
      }
      setInterim(partial.trim());
      onInterimRef.current?.(partial.trim());
      if (finalText.trim()) {
        setInterim('');
        onFinalRef.current(finalText.trim());
      }
    };

    rec.onerror = (event) => {
      const code = event.error ?? 'unknown';
      setListening(false);
      if (code === 'aborted') {
        setInterim('');
        return;
      }
      setError({ code, ...(ERROR_COPY[code] ?? { message: `Échec de la reconnaissance vocale (${code}).` }) });
    };

    rec.onend = () => {
      setListening(false);
      if (wantedRef.current && autoRestartRef.current && !window.speechSynthesis?.speaking) {
        try {
          rec.start();
          setListening(true);
        } catch {
          /* restarted by the caller */
        }
      }
    };

    try {
      rec.start();
      setListening(true);
    } catch (e) {
      // InvalidStateError: an instance is already running. Stop it and retry once.
      const message = e instanceof Error ? e.message : '';
      if (/already started|InvalidState/i.test(message)) {
        try {
          rec.abort();
          rec.start();
          setListening(true);
        } catch {
          setError({ code: 'busy', message: 'Le micro est déjà utilisé par cette page.' });
        }
      } else {
        setError({ code: 'start-failed', message: 'Le micro n’a pas pu démarrer.', hint: message });
      }
    }
  }, [lang, continuous, interimResults]);

  const toggle = useCallback(async () => {
    if (listening) stop();
    else await start();
  }, [listening, start, stop]);

  return {
    supported,
    listening,
    interim,
    error,
    start,
    stop,
    toggle,
    clearError: () => setError(null),
  };
}

/* -------------------------------------------------------------------------- */

export type VoiceSettings = { voiceURI: string; rate: number; pitch: number };

const VOICE_PREFS_KEY = 'ai-core.voice.prefs';

const DEFAULT_PREFS: VoiceSettings = { voiceURI: '', rate: 1, pitch: 1 };

function parsePrefs(raw: string): VoiceSettings {
  try {
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return {
      voiceURI: typeof parsed.voiceURI === 'string' ? parsed.voiceURI : '',
      rate: typeof parsed.rate === 'number' ? parsed.rate : 1,
      pitch: typeof parsed.pitch === 'number' ? parsed.pitch : 1,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/**
 * Speech synthesis with persisted settings (voice, rate, pitch).
 * `speak` returns a promise that resolves when the utterance ends, so a caller
 * can chain "COO finished talking → cue → mic back on".
 */
const EMPTY_VOICES: SpeechSynthesisVoice[] = [];
let voicesCache: SpeechSynthesisVoice[] = EMPTY_VOICES;
let voicesSignature = '\u0000';

/** Cached snapshot: useSyncExternalStore requires a stable reference. */
function frVoicesSnapshot(): SpeechSynthesisVoice[] {
  const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
  if (!synth) return EMPTY_VOICES;
  const all = synth.getVoices();
  const signature = all.map((v) => v.voiceURI).join('|');
  if (signature !== voicesSignature) {
    voicesSignature = signature;
    voicesCache = all.filter((v) => v.lang.toLowerCase().startsWith('fr'));
  }
  return voicesCache;
}

function subscribeVoices(onChange: () => void): () => void {
  const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
  if (!synth?.addEventListener) return () => {};
  synth.addEventListener('voiceschanged', onChange);
  return () => synth.removeEventListener?.('voiceschanged', onChange);
}

export function useSpeechOutput(lang = 'fr-FR') {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => typeof window !== 'undefined' && Boolean(window.speechSynthesis),
    () => false,
  );
  const voices = useSyncExternalStore(subscribeVoices, frVoicesSnapshot, () => EMPTY_VOICES);
  // Persisted through the localStorage store: the server snapshot is the
  // default, so hydration never disagrees with the first client paint.
  const [rawPrefs, setRawPrefs] = useStoredString(VOICE_PREFS_KEY, JSON.stringify(DEFAULT_PREFS));
  const settings = useMemo(() => parsePrefs(rawPrefs), [rawPrefs]);
  const [speaking, setSpeaking] = useState(false);

  const update = useCallback(
    (patch: Partial<VoiceSettings>) => setRawPrefs(JSON.stringify({ ...settings, ...patch })),
    [settings, setRawPrefs],
  );

  const cancel = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string, overrides?: Partial<VoiceSettings>): Promise<void> => {
      const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
      if (!synth || !text.trim()) return Promise.resolve();
      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        const pool = synth.getVoices();
        const wanted = overrides?.voiceURI ?? settings.voiceURI;
        const chosen =
          pool.find((v) => v.voiceURI === wanted) ?? pool.find((v) => v.lang.toLowerCase().startsWith('fr'));
        if (chosen) utterance.voice = chosen;
        utterance.rate = overrides?.rate ?? settings.rate;
        utterance.pitch = overrides?.pitch ?? settings.pitch;
        utterance.onend = () => {
          setSpeaking(false);
          resolve();
        };
        utterance.onerror = () => {
          setSpeaking(false);
          resolve();
        };
        setSpeaking(true);
        synth.cancel();
        synth.speak(utterance);
      });
    },
    [lang, settings.pitch, settings.rate, settings.voiceURI],
  );

  return { supported, voices, settings, update, speaking, speak, cancel };
}

/* -------------------------------------------------------------------------- */

const audioCtxRef: { current: AudioContext | null } = { current: null };

/** Short, non-intrusive cue. `ready` invites the user to speak. */
export function playCue(kind: 'ready' | 'stop' = 'ready'): void {
  try {
    if (typeof window === 'undefined') return;
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtxRef.current ??= new Ctor();
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'ready' ? 1600 : 520;
    gain.gain.setValueAtTime(0.07, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    /* a cue is a comfort, never a blocker */
  }
}
