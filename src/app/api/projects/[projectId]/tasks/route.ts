import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject, requireUser } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { emitAndNotify } from '@/engine/events';
import { recordAudit } from '@/lib/audit';

const updateSchema = z.object({
  taskId: z.string().uuid(),
  priority: z.number().int().min(1).max(5).optional(),
  status: z.string().optional(),
  assignedAgentKey: z.string().optional(),
});

/**
 * Task graph (§16, §30). Returns tasks plus their dependency edges so the UI can
 * render both the board and the execution graph from the same payload.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const db = await getDb();

    const tasks = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId))
      .orderBy(asc(schema.tasks.priority), asc(schema.tasks.createdAt));

    const taskIds = new Set(tasks.map((t) => t.id));
    const deps = (await db.select().from(schema.taskDependencies)).filter((d) => taskIds.has(d.taskId));

    return jsonOk({
      tasks: tasks.map((task) => ({
        id: task.id,
        runId: task.runId,
        goalId: task.goalId,
        parentTaskId: task.parentTaskId,
        title: task.title,
        description: task.description,
        acceptanceCriteria: task.acceptanceCriteria,
        status: task.status,
        priority: task.priority,
        assignedAgentKey: task.assignedAgentDefinitionKey,
        origin: task.origin,
        attemptCount: task.attemptCount,
        maxAttempts: task.maxAttempts,
        blockedReason: task.blockedReason,
        outputSummary: task.outputSummary,
        position: task.position,
        startedAt: task.startedAt?.toISOString() ?? null,
        finishedAt: task.finishedAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
      })),
      dependencies: deps.map((d) => ({ taskId: d.taskId, dependsOnTaskId: d.dependsOnTaskId })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** Humans can reprioritise or reassign; this is the intervention surface (§5). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const user = await requireUser();
    const body = await parseBody(request, updateSchema);
    const db = await getDb();

    const existing = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, body.taskId))
      .limit(1);
    const task = existing[0];
    // Explicit project check: the task must belong to this project.
    if (!task || task.projectId !== projectId) {
      return jsonError(new Error('Task not found in this project'));
    }

    await db
      .update(schema.tasks)
      .set({
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.assignedAgentKey !== undefined
          ? { assignedAgentDefinitionKey: body.assignedAgentKey || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, task.id));

    if (task.runId) {
      await emitAndNotify({
        runId: task.runId,
        projectId,
        type: 'task.updated',
        actor: 'user',
        taskId: task.id,
        summary: `User updated task "${task.title}"${body.priority ? ` → priority ${body.priority}` : ''}${body.assignedAgentKey ? ` → ${body.assignedAgentKey}` : ''}`,
      });
    }

    await recordAudit({
      action: 'task.update',
      projectId,
      userId: user.id,
      entityType: 'task',
      entityId: task.id,
      metadata: { priority: body.priority, status: body.status, agent: body.assignedAgentKey },
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
