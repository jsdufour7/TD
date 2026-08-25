import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';

/** List the project's objectives (executive layer), newest first. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const db = await getDb();

    const objectives = await db
      .select()
      .from(schema.objectives)
      .where(eq(schema.objectives.projectId, projectId))
      .orderBy(desc(schema.objectives.createdAt));

    return jsonOk({
      objectives: objectives.map((o) => ({
        id: o.id,
        title: o.title,
        description: o.description,
        status: o.status,
        autonomyMode: o.autonomyMode,
        priority: o.priority,
        successCriteria: o.successCriteria,
        startedAt: o.startedAt?.toISOString() ?? null,
        completedAt: o.completedAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
