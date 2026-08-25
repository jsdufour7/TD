import { jsonError, jsonOk } from '@/lib/api';
import { requireUser } from '@/auth/guards';
import { AppError } from '@/lib/errors';

/**
 * Voice Router — STT (§19).
 *
 * Proxies audio to a configured local STT server (whisper.cpp / faster-whisper
 * exposing an OpenAI-compatible /v1/audio/transcriptions). With none configured,
 * it reports unavailability cleanly instead of fabricating a transcript; the
 * client then falls back to the browser's free recognition engine.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireUser();
    const sttUrl = process.env.VOICE_STT_URL;
    if (!sttUrl) {
      throw new AppError(
        'provider_unavailable',
        'No local STT configured. Set VOICE_STT_URL (whisper.cpp / faster-whisper) or use the browser microphone fallback.',
      );
    }

    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof Blob)) throw new AppError('validation', 'Missing audio blob');

    const upstream = await fetch(`${sttUrl.replace(/\/+$/, '')}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
    });
    if (!upstream.ok) throw new AppError('provider_offline', `STT answered HTTP ${upstream.status}`);
    const data = (await upstream.json()) as { text?: string };
    return jsonOk({ text: data.text ?? '' });
  } catch (error) {
    return jsonError(error);
  }
}
