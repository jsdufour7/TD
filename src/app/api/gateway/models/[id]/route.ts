import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireAdmin } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { notFound } from '@/lib/errors';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const admin = await requireAdmin();
    const db = await getDb();

    const model = (await db.select().from(schema.modelDefinitions).where(eq(schema.modelDefinitions.id, id)).limit(1))[0];
    if (!model) throw notFound('Model not found');

    await db.delete(schema.modelDefinitions).where(eq(schema.modelDefinitions.id, model.id));

    await recordAudit({
      action: 'gateway.model.delete',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'model_definition',
      entityId: model.id,
      metadata: { modelKey: model.modelKey },
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
