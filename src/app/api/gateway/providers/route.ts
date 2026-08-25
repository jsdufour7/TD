import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireAdmin } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { encryptSecret, fingerprintSecret } from '@/lib/crypto';
import { AppError } from '@/lib/errors';

/**
 * Model gateway management (§21–§23).
 *
 * Providers and models are data, not code: this endpoint lets an admin add a
 * local gateway (llama.cpp, Ollama, vLLM) or a hosted one without a deploy.
 * Credentials are stored encrypted (AES-256-GCM) and only a fingerprint is ever
 * returned. Admin-only; every mutation audited.
 */

const createSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,40}$/i, 'key must be a short slug like "ollama" or "llama-cpp"'),
  name: z.string().min(1).max(120),
  kind: z.enum(['openai_compatible', 'anthropic']).default('openai_compatible'),
  baseUrl: z.string().url(),
  apiKey: z.string().max(500).optional().describe('Optional; stored encrypted. Leave empty for local endpoints.'),
  isLocal: z.boolean().default(false),
  isPrivate: z.boolean().default(false),
});

export async function serializeGateway(db: Awaited<ReturnType<typeof getDb>>) {
  const providers = await db.select().from(schema.modelProviders);
  const models = await db.select().from(schema.modelDefinitions);
  const routes = await db.select().from(schema.modelRoutes);
  const credentials = await db.select().from(schema.credentialReferences);
  const credById = new Map(credentials.map((c) => [c.id, c]));

  return {
    providers: providers.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      kind: p.kind,
      baseUrl: p.baseUrl,
      isLocal: p.isLocal,
      isPrivate: p.isPrivate,
      isEnabled: p.isEnabled,
      healthStatus: p.healthStatus,
      healthMessage: p.healthMessage,
      healthLatencyMs: p.healthLatencyMs,
      lastHealthAt: p.lastHealthAt?.toISOString() ?? null,
      credentialConfigured: Boolean(p.credentialId && credById.get(p.credentialId)?.fingerprint),
      credentialFingerprint: p.credentialId ? (credById.get(p.credentialId)?.fingerprint ?? null) : null,
      models: models
        .filter((m) => m.providerId === p.id)
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
          isEnabled: m.isEnabled,
        })),
    })),
    routes: routes.map((r) => ({
      id: r.id,
      policy: r.policy,
      modelId: r.modelId,
      priority: r.priority,
      isEnabled: r.isEnabled,
      model: models.find((m) => m.id === r.modelId)?.displayName ?? 'Unknown',
    })),
  };
}

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();
    const db = await getDb();
    return jsonOk(await serializeGateway(db));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const admin = await requireAdmin();
    const body = await parseBody(request, createSchema);
    const db = await getDb();

    const existing = await db.select({ id: schema.modelProviders.id }).from(schema.modelProviders).where(eq(schema.modelProviders.key, body.key)).limit(1);
    if (existing[0]) throw new AppError('conflict', `A provider with key "${body.key}" already exists`);

    // Store the API key encrypted; only a fingerprint is ever returned.
    let credentialId: string | null = null;
    if (body.apiKey) {
      const [cred] = await db
        .insert(schema.credentialReferences)
        .values({
          name: `${body.key}-api-key`,
          source: 'encrypted',
          ciphertext: encryptSecret(body.apiKey),
          fingerprint: fingerprintSecret(body.apiKey),
        })
        .returning();
      credentialId = cred!.id;
    }

    const [provider] = await db
      .insert(schema.modelProviders)
      .values({
        key: body.key,
        name: body.name,
        kind: body.kind,
        baseUrl: body.baseUrl,
        credentialId,
        isLocal: body.isLocal,
        isPrivate: body.isPrivate || body.isLocal,
        isEnabled: true,
        healthStatus: 'unknown',
      })
      .returning();

    await recordAudit({
      action: 'gateway.provider.create',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'model_provider',
      entityId: provider!.id,
      metadata: { key: provider!.key, kind: provider!.kind, baseUrl: provider!.baseUrl, isLocal: provider!.isLocal },
    });

    // Immediately probe health and discover models so a freshly connected
    // llama.cpp / Ollama is usable by the COO right away (a provider with no
    // models is skipped by the router, which read as "not connected").
    let discovered = 0;
    let health: { status: string; message: string; latencyMs: number } = { status: 'unknown', message: '', latencyMs: 0 };
    try {
      const { buildProvider } = await import('@/ai/router');
      const { resolveCredential } = await import('@/ai/credentials');
      const cred = credentialId
        ? (await db.select().from(schema.credentialReferences).where(eq(schema.credentialReferences.id, credentialId)).limit(1))[0]
        : undefined;
      const resolved = await resolveCredential(cred);
      const adapter = buildProvider(provider!, resolved?.value ?? null);
      health = await adapter.health();

      const upstream = await fetch(`${provider!.baseUrl.replace(/\/+$/, '')}/models`, {
        headers: resolved?.value ? { authorization: `Bearer ${resolved.value}` } : {},
      });
      if (upstream.ok) {
        const data = (await upstream.json()) as { data?: Array<{ id?: string; name?: string }> };
        for (const m of data.data ?? []) {
          const key = m.id ?? m.name;
          if (!key) continue;
          await db
            .insert(schema.modelDefinitions)
            .values({
              providerId: provider!.id,
              modelKey: key,
              displayName: key,
              isEnabled: true,
              supportsTools: provider!.kind === 'openai_compatible',
            })
            .onConflictDoNothing();
          discovered += 1;
        }
      }
      await db
        .update(schema.modelProviders)
        .set({ healthStatus: health.status, healthMessage: health.message, healthLatencyMs: health.latencyMs, lastHealthAt: new Date() })
        .where(eq(schema.modelProviders.id, provider!.id));
    } catch {
      /* discovery is best-effort; the provider can still be discovered later */
    }

    return jsonOk(
      { provider: { id: provider!.id, key: provider!.key, name: provider!.name }, discovered, health: health.status },
      201,
    );
  } catch (error) {
    return jsonError(error);
  }
}
