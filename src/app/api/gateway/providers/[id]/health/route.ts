import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireAdmin } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';
import { buildProvider } from '@/ai/router';
import { resolveCredential } from '@/ai/credentials';
import { recordAudit } from '@/lib/audit';
import { notFound } from '@/lib/errors';

/**
 * Probe a single provider and persist the result. Never throws: a provider that
 * is down is reported as offline, which is exactly the state the router needs.
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

    const adapter = buildProvider(provider, resolved?.value ?? null);
    const health = await adapter.health();

    await db
      .update(schema.modelProviders)
      .set({
        healthStatus: health.status,
        healthMessage: health.message,
        healthLatencyMs: health.latencyMs,
        lastHealthAt: new Date(),
      })
      .where(eq(schema.modelProviders.id, provider.id));

    await recordAudit({
      action: 'gateway.provider.health',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'model_provider',
      entityId: provider.id,
      metadata: { key: provider.key, status: health.status, latencyMs: health.latencyMs },
    });

    return jsonOk({ status: health.status, message: health.message, latencyMs: health.latencyMs });
  } catch (error) {
    return jsonError(error);
  }
}
