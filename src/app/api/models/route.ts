import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireUser } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';
import { usageSummary } from '@/ai/router';

/**
 * Model gateway surface (§21–§23, §42).
 *
 * Credentials are never returned. Providers expose a fingerprint and a
 * configured flag so the UI can prove a key exists without ever seeing it.
 */
export async function GET(): Promise<Response> {
  try {
    await requireUser();
    const db = await getDb();

    const providers = await db.select().from(schema.modelProviders);
    const models = await db.select().from(schema.modelDefinitions);
    const routes = await db.select().from(schema.modelRoutes);
    const credentials = await db.select().from(schema.credentialReferences);

    const credentialById = new Map(credentials.map((c) => [c.id, c]));

    const usage = await usageSummary();

    return jsonOk({
      providers: providers.map((provider) => {
        const credential = provider.credentialId ? credentialById.get(provider.credentialId) : undefined;
        return {
          id: provider.id,
          key: provider.key,
          name: provider.name,
          kind: provider.kind,
          baseUrl: provider.baseUrl,
          isLocal: provider.isLocal,
          isPrivate: provider.isPrivate,
          isEnabled: provider.isEnabled,
          healthStatus: provider.healthStatus,
          healthMessage: provider.healthMessage,
          healthLatencyMs: provider.healthLatencyMs,
          lastHealthAt: provider.lastHealthAt?.toISOString() ?? null,
          // Fingerprint only — the secret itself never leaves the server.
          credentialConfigured: Boolean(credential?.fingerprint),
          credentialFingerprint: credential?.fingerprint ?? null,
          credentialEnvVar: credential?.envVar ?? null,
          models: models
            .filter((m) => m.providerId === provider.id)
            .map((m) => ({
              id: m.id,
              modelKey: m.modelKey,
              displayName: m.displayName,
              contextLength: m.contextLength,
              supportsTools: m.supportsTools,
              supportsVision: m.supportsVision,
              reasoningTier: m.reasoningTier,
              codingTier: m.codingTier,
              costInputPerMtok: m.costInputPerMtok,
              costOutputPerMtok: m.costOutputPerMtok,
              latencyClass: m.latencyClass,
              isEnabled: m.isEnabled,
            })),
        };
      }),
      routes: routes.map((route) => ({
        id: route.id,
        policy: route.policy,
        modelId: route.modelId,
        priority: route.priority,
        isEnabled: route.isEnabled,
        model: models.find((m) => m.id === route.modelId)?.displayName ?? 'Unknown model',
      })),
      usage: {
        totalCalls: usage.totalCalls,
        totalInputTokens: usage.totalInputTokens,
        totalOutputTokens: usage.totalOutputTokens,
        totalCostUsd: Number(usage.totalCostUsd.toFixed(6)),
        byModel: usage.byModel,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** Look up a single provider — used by the health panel. */
export async function HEAD(): Promise<Response> {
  try {
    await requireUser();
    const db = await getDb();
    const providers = await db.select({ id: schema.modelProviders.id }).from(schema.modelProviders);
    return new Response(null, { status: 200, headers: { 'x-provider-count': String(providers.length) } });
  } catch {
    return new Response(null, { status: 500 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    await requireUser();
    const body = (await request.json()) as { providerId?: string; isEnabled?: boolean };
    if (!body.providerId) return jsonError(new Error('providerId is required'));

    const db = await getDb();
    await db
      .update(schema.modelProviders)
      .set({ isEnabled: Boolean(body.isEnabled) })
      .where(eq(schema.modelProviders.id, body.providerId));

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
