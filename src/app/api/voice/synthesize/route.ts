import { z } from 'zod';
import { jsonError, parseBody } from '@/lib/api';
import { requireUser } from '@/auth/guards';
import { AppError } from '@/lib/errors';

const bodySchema = z.object({ text: z.string().min(1).max(5000), voice: z.string().optional() });

/**
 * Voice Router — TTS (§19). Proxies to a configured local TTS (Kokoro / Piper,
 * OpenAI-compatible /v1/audio/speech). The client also has the browser's free
 * speechSynthesis as a zero-provider default.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireUser();
    const body = await parseBody(request, bodySchema);

    // 1) Local (Kokoro / Piper), OpenAI-compatible /v1/audio/speech.
    const ttsUrl = process.env.VOICE_TTS_URL;
    if (ttsUrl) {
      const upstream = await fetch(`${ttsUrl.replace(/\/+$/, '')}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: body.text, voice: body.voice ?? 'default', response_format: 'mp3' }),
      });
      if (upstream.ok) return audio(await upstream.arrayBuffer());
    }

    // 2) Cloud upgrade: OpenAI TTS.
    if (process.env.OPENAI_API_KEY) {
      const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: body.voice ?? 'nova', input: body.text }),
      });
      if (upstream.ok) return audio(await upstream.arrayBuffer());
    }

    // 3) Cloud upgrade: ElevenLabs.
    if (process.env.ELEVENLABS_API_KEY) {
      const upstream = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM'}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
          body: JSON.stringify({ text: body.text, model_id: 'eleven_turbo_v2_5' }),
        },
      );
      if (upstream.ok) return audio(await upstream.arrayBuffer());
    }

    throw new AppError(
      'provider_unavailable',
      'Aucun moteur TTS configuré (VOICE_TTS_URL / OPENAI_API_KEY / ELEVENLABS_API_KEY). Repli sur la voix navigateur.',
    );
  } catch (error) {
    return jsonError(error);
  }
}

function audio(buf: ArrayBuffer): Response {
  return new Response(buf, { headers: { 'content-type': 'audio/mpeg' } });
}
