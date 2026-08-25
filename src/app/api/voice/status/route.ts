import { jsonError, jsonOk } from '@/lib/api';
import { requireUser } from '@/auth/guards';
import { detectVoice } from '@/voice/router';

/**
 * Report which local voice engines are available and how to enable them.
 * Honest by construction: with nothing installed it says so and points to the
 * browser fallback.
 */
export async function GET(): Promise<Response> {
  try {
    await requireUser();
    const voice = await detectVoice();
    return jsonOk({
      stt: voice.stt,
      tts: voice.tts,
      browserFallback: {
        stt: 'SpeechRecognition / webkitSpeechRecognition (gratuit)',
        tts: 'speechSynthesis (gratuit, local)',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
