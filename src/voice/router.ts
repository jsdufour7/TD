import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Voice Router (§19) — local-first, cloud-optional.
 *
 * Detection order for each leg:
 *   1. Explicit env override (VOICE_STT_URL / VOICE_TTS_URL).
 *   2. A known local port already answering.
 *   3. A binary on PATH that could be launched.
 *
 * Nothing is assumed: if no local engine exists, the router says so and the
 * client falls back to the browser's free engines. No paid provider is ever
 * required (§33).
 */

export type VoiceLeg = {
  kind: 'stt' | 'tts';
  provider: string;
  available: boolean;
  source: 'env' | 'port' | 'binary' | 'none';
  detail: string;
};

const STT_BINARIES = ['whisper-server', 'whisper-cpp', 'whisper.cpp', 'faster-whisper', 'whisper'];
const TTS_BINARIES = ['kokoro-tts', 'kokoro', 'piper'];

async function hasBinary(name: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [name]);
    return true;
  } catch {
    return false;
  }
}

async function portOpen(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function detectVoice(): Promise<{ stt: VoiceLeg; tts: VoiceLeg }> {
  const sttUrl = process.env.VOICE_STT_URL;
  const ttsUrl = process.env.VOICE_TTS_URL;

  let stt: VoiceLeg;
  if (sttUrl) {
    stt = { kind: 'stt', provider: 'whisper(local)', available: await portOpen(sttUrl), source: 'env', detail: sttUrl };
  } else if (await portOpen('http://127.0.0.1:8178/v1/models')) {
    stt = { kind: 'stt', provider: 'whisper.cpp', available: true, source: 'port', detail: 'http://127.0.0.1:8178' };
  } else {
    const bin = await firstAvailable(STT_BINARIES);
    stt = bin
      ? { kind: 'stt', provider: bin, available: false, source: 'binary', detail: `binaire détecté: ${bin} (démarrez-le ou configurez VOICE_STT_URL)` }
      : { kind: 'stt', provider: 'none', available: false, source: 'none', detail: 'aucun STT local; repli navigateur' };
  }

  let tts: VoiceLeg;
  if (ttsUrl) {
    tts = { kind: 'tts', provider: 'kokoro/piper(local)', available: await portOpen(ttsUrl), source: 'env', detail: ttsUrl };
  } else if (await portOpen('http://127.0.0.1:8179/v1/models')) {
    tts = { kind: 'tts', provider: 'kokoro/piper', available: true, source: 'port', detail: 'http://127.0.0.1:8179' };
  } else {
    const bin = await firstAvailable(TTS_BINARIES);
    tts = bin
      ? { kind: 'tts', provider: bin, available: false, source: 'binary', detail: `binaire détecté: ${bin} (démarrez-le ou configurez VOICE_TTS_URL)` }
      : { kind: 'tts', provider: 'none', available: false, source: 'none', detail: 'aucun TTS local; repli navigateur (speechSynthesis)' };
  }

  return { stt, tts };
}

async function firstAvailable(names: string[]): Promise<string | null> {
  for (const name of names) {
    if (await hasBinary(name)) return name;
  }
  return null;
}
