import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireAdmin } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { ROUTING_POLICIES } from '@/ai/router';
import { AppError } from '@/lib/errors';

const assignSchema = z.object({
  policy: z.enum(ROUTING_POLICIES),
  modelId: z.string().uuid(),
});

/**
 * Assign a model to a routing policy (§23). Policies are data; this lets an
 * admin point e.g. CODING_MAX at a strong local model without touching code.
 */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const admin = await requireAdmin();
    const body = await parseBody(request, assignSchema);
    const db = await getDb();

    const model = (await db.select().from(schema.modelDefinitions).where(eq(schema.modelDefinitions.id, body.modelId)).limit(1))[0];
    if (!model) throw new AppError('not_found', 'Model not found');

    const existing = await db
      .select()
      .from(schema.modelRoutes)
      .where(and(eq(schema.modelRoutes.policy, body.policy)))
      .orderBy(schema.modelRoutes.priority)
      .limit(1);

    if (existing[0]) {
      await db.update(schema.modelRoutes).set({ modelId: body.modelId, isEnabled: true }).where(eq(schema.modelRoutes.id, existing[0].id));
    } else {
      await db.insert(schema.modelRoutes).values({ policy: body.policy, modelId: body.modelId, priority: 100, isEnabled: true });
    }

    await recordAudit({
      action: 'gateway.route.assign',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'model_route',
      metadata: { policy: body.policy, modelKey: model.modelKey },
    });

    return jsonOk({ ok: true, policy: body.policy, modelKey: model.modelKey });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();
    const db = await getDb();
    const routes = await db.select().from(schema.modelRoutes);
    const models = await db.select().from(schema.modelDefinitions);
    return jsonOk({
      policies: ROUTING_POLICIES,
      routes: routes.map((r) => ({
        policy: r.policy,
        modelId: r.modelId,
        model: models.find((m) => m.id === r.modelId)?.displayName ?? 'Unknown',
        isEnabled: r.isEnabled,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
