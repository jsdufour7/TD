import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireUser } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';

/**
 * Agent observability (§28).
 *
 * Returns the catalog plus live instances. Statuses are read from the database,
 * so an agent shown as "Working" is genuinely mid-execution.
 */
export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    const db = await getDb();

    const definitions = await db
      .select()
      .from(schema.agentDefinitions)
      .orderBy(schema.agentDefinitions.sortOrder);

    const projects = await db
      .select({ id: schema.projects.id, name: schema.projects.name })
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, user.organizationId));
    const projectIds = projects.map((p) => p.id);
    const projectById = new Map(projects.map((p) => [p.id, p.name]));

    const instances =
      projectIds.length > 0
        ? await db
            .select()
            .from(schema.agentInstances)
            .where(inArray(schema.agentInstances.projectId, projectIds))
            .orderBy(desc(schema.agentInstances.startedAt))
            .limit(100)
        : [];

    const tasks =
      projectIds.length > 0
        ? await db
            .select({ id: schema.tasks.id, title: schema.tasks.title })
            .from(schema.tasks)
            .where(inArray(schema.tasks.projectId, projectIds))
        : [];
    const taskById = new Map(tasks.map((t) => [t.id, t.title]));

    return jsonOk({
      definitions: definitions.map((d) => ({
        key: d.key,
        name: d.name,
        role: d.role,
        description: d.description,
        allowedTools: d.allowedTools,
        permissions: d.permissions,
        modelPolicy: d.modelPolicy,
        maxSteps: d.maxSteps,
        maxConcurrency: d.maxConcurrency,
        budgetTier: d.budgetTier,
        accentColor: d.accentColor,
        icon: d.icon,
        isActive: d.isActive,
        instanceCount: instances.filter((i) => i.definitionKey === d.key).length,
        activeCount: instances.filter(
          (i) => i.definitionKey === d.key && !['completed', 'failed'].includes(i.status),
        ).length,
      })),
      instances: instances.map((i) => ({
        id: i.id,
        definitionKey: i.definitionKey,
        name: definitions.find((d) => d.key === i.definitionKey)?.name ?? i.definitionKey,
        role: definitions.find((d) => d.key === i.definitionKey)?.role ?? '',
        accentColor: definitions.find((d) => d.key === i.definitionKey)?.accentColor ?? 'sky',
        projectId: i.projectId,
        projectName: projectById.get(i.projectId) ?? 'Unknown',
        runId: i.runId,
        taskId: i.taskId,
        taskTitle: i.taskId ? (taskById.get(i.taskId) ?? null) : null,
        status: i.status,
        lastAction: i.lastAction,
        modelId: i.modelId,
        providerKey: i.providerKey,
        stepsUsed: i.stepsUsed,
        toolCalls: i.toolCalls,
        error: i.error,
        summary: i.summary,
        startedAt: i.startedAt.toISOString(),
        finishedAt: i.finishedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export { and };
