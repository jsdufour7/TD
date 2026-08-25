import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireAdmin } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { encryptSecret, fingerprintSecret } from '@/lib/crypto';
import { notFound } from '@/lib/errors';

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  baseUrl: z.string().url().optional(),
  kind: z.enum(['openai_compatible', 'anthropic']).optional(),
  isEnabled: z.boolean().optional(),
  isLocal: z.boolean().optional(),
  isPrivate: z.boolean().optional(),
  /** Set to replace the stored key; "" clears it. */
  apiKey: z.string().max(500).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const admin = await requireAdmin();
    const body = await parseBody(request, patchSchema);
    const db = await getDb();

    const rows = await db.select().from(schema.modelProviders).where(eq(schema.modelProviders.id, id)).limit(1);
    const provider = rows[0];
    if (!provider) throw notFound('Provider not found');

    let credentialId = provider.credentialId;
    if (body.apiKey !== undefined) {
      if (body.apiKey === '') {
        credentialId = null;
      } else if (provider.credentialId) {
        await db
          .update(schema.credentialReferences)
          .set({ ciphertext: encryptSecret(body.apiKey), fingerprint: fingerprintSecret(body.apiKey), source: 'encrypted' })
          .where(eq(schema.credentialReferences.id, provider.credentialId));
      } else {
        const [cred] = await db
          .insert(schema.credentialReferences)
          .values({
            name: `${provider.key}-api-key`,
            source: 'encrypted',
            ciphertext: encryptSecret(body.apiKey),
            fingerprint: fingerprintSecret(body.apiKey),
          })
          .returning();
        credentialId = cred!.id;
      }
    }

    const [updated] = await db
      .update(schema.modelProviders)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
        ...(body.isLocal !== undefined ? { isLocal: body.isLocal } : {}),
        ...(body.isPrivate !== undefined ? { isPrivate: body.isPrivate } : {}),
        credentialId,
      })
      .where(eq(schema.modelProviders.id, provider.id))
      .returning();

    await recordAudit({
      action: 'gateway.provider.update',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'model_provider',
      entityId: provider.id,
      metadata: { key: provider.key, baseUrl: body.baseUrl ?? null, isEnabled: body.isEnabled ?? null },
    });

    return jsonOk({ provider: { id: updated!.id, key: updated!.key, name: updated!.name } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
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

    // Cascades delete models; detach credential then delete it.
    await db.delete(schema.modelProviders).where(eq(schema.modelProviders.id, provider.id));
    if (provider.credentialId) {
      await db.delete(schema.credentialReferences).where(eq(schema.credentialReferences.id, provider.credentialId));
    }

    await recordAudit({
      action: 'gateway.provider.delete',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'model_provider',
      entityId: provider.id,
      metadata: { key: provider.key },
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
