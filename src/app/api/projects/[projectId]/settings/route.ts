import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject, requireUser } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { recordAudit } from '@/lib/audit';

const patchSchema = z.object({
  description: z.string().max(2000).optional(),
  businessPurpose: z.string().max(2000).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const user = await requireUser();
    const body = await parseBody(request, patchSchema);
    const db = await getDb();

    await db
      .update(schema.projects)
      .set({
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.businessPurpose !== undefined ? { businessPurpose: body.businessPurpose || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, projectId));

    await recordAudit({
      action: 'project.update',
      projectId,
      userId: user.id,
      entityType: 'project',
      entityId: projectId,
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
