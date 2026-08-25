import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireAdmin } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';
import { resolveCredential } from '@/ai/credentials';
import { recordAudit } from '@/lib/audit';
import { notFound } from '@/lib/errors';

/**
 * Discover the models a provider currently exposes.
 *
 * OpenAI-compatible servers (llama.cpp, Ollama `/v1`, vLLM, OpenRouter) and
 * Anthropic both answer `GET /models` with `{ data: [{ id }] }`, so one code
 * path serves them all. This is what makes "add my local llama.cpp / Ollama"
 * nearly automatic: connect the gateway, then Discover.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const admin = await requireAdmin();
    const db = await getDb();

    const rows = await db.select().from(schema.modelProviders).where(eq(schema.modelProviders.id, id)).limit(1);
    const provider = rows[0];
    if (!provider) throw notFound('Provider not found');

    const credential = provider.credentialId
      ? (await db.select().from(schema.credentialReferences).where(eq(schema.credentialReferences.id, provider.credentialId)).limit(1))[0]
      : undefined;
    const resolved = await resolveCredential(credential);

    const url = `${provider.baseUrl.replace(/\/+$/, '')}/models`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (resolved?.value) headers.authorization = `Bearer ${resolved.value}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      return jsonError(
        new Error(
          `Cannot reach ${url}: ${error instanceof Error ? error.message : String(error)}. ` +
            'Is the local server (llama.cpp / Ollama) running?',
        ),
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      return jsonError(new Error(`Provider answered HTTP ${response.status} on GET /models`));
    }

    let parsed: { data?: Array<{ id?: string; name?: string }> };
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      return jsonError(new Error('Provider returned a non-JSON /models response'));
    }

    const discovered = (parsed.data ?? [])
      .map((m) => m.id ?? m.name)
      .filter((x): x is string => Boolean(x));

    await recordAudit({
      action: 'gateway.provider.discover',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'model_provider',
      entityId: provider.id,
      metadata: { key: provider.key, count: discovered.length },
    });

    return jsonOk({ models: discovered });
  } catch (error) {
    return jsonError(error);
  }
}
