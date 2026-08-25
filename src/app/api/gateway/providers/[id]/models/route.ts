import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireAdmin } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { AppError, notFound } from '@/lib/errors';

const modelSchema = z.object({
  modelKey: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200).optional(),
  contextLength: z.number().int().min(512).max(2_000_000).default(8192),
  supportsTools: z.boolean().default(false),
  supportsVision: z.boolean().default(false),
  reasoningTier: z.enum(['fast', 'balanced', 'strong']).default('balanced'),
  codingTier: z.enum(['weak', 'capable', 'strong']).default('capable'),
  costInputPerMtok: z.string().default('0'),
  costOutputPerMtok: z.string().default('0'),
});

/**
 * Add a model under a provider. Local models default to zero cost and
 * tools-off (many local servers do not implement tool calling); both are
 * editable afterwards.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const admin = await requireAdmin();
    const body = await parseBody(request, modelSchema);
    const db = await getDb();

    const provider = (await db.select().from(schema.modelProviders).where(eq(schema.modelProviders.id, id)).limit(1))[0];
    if (!provider) throw notFound('Provider not found');

    const dup = await db
      .select({ id: schema.modelDefinitions.id })
      .from(schema.modelDefinitions)
      .where(and(eq(schema.modelDefinitions.providerId, id), eq(schema.modelDefinitions.modelKey, body.modelKey)))
      .limit(1);
    if (dup[0]) throw new AppError('conflict', `Model "${body.modelKey}" already exists on this provider`);

    const [model] = await db
      .insert(schema.modelDefinitions)
      .values({
        providerId: id,
        modelKey: body.modelKey,
        displayName: body.displayName ?? body.modelKey,
        contextLength: body.contextLength,
        supportsTools: body.supportsTools,
        supportsVision: body.supportsVision,
        reasoningTier: body.reasoningTier,
        codingTier: body.codingTier,
        costInputPerMtok: body.costInputPerMtok,
        costOutputPerMtok: body.costOutputPerMtok,
        isEnabled: true,
      })
      .returning();

    await recordAudit({
      action: 'gateway.model.create',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'model_definition',
      entityId: model!.id,
      metadata: { provider: provider.key, modelKey: body.modelKey },
    });

    return jsonOk({ model: { id: model!.id, modelKey: model!.modelKey } }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
