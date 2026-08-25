import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject, requireUser } from '@/auth/guards';
import { jsonError, jsonOk, parseBody, parseQuery } from '@/lib/api';
import { createRun } from '@/engine/run-engine';
import { ROUTING_POLICIES } from '@/ai/router';

const createSchema = z.object({
  objective: z.string().min(3).max(20000),
  title: z.string().max(200).optional(),
  routingPolicy: z.enum(ROUTING_POLICIES).optional(),
  conversationId: z.string().uuid().optional(),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().optional(),
});

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const query = parseQuery(new URL(request.url), listSchema);
    const db = await getDb();

    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(
        // NOTE: conditions must be combined with and(). Using && here would
        // evaluate to the second operand and silently drop the status filter.
        query.status
          ? and(eq(schema.agentRuns.projectId, projectId), eq(schema.agentRuns.status, query.status))
          : eq(schema.agentRuns.projectId, projectId),
      )
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(query.limit);

    return jsonOk({ runs: runs.map(serialiseRun) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const user = await requireUser();
    const body = await parseBody(request, createSchema);

    const run = await createRun({
      projectId,
      objective: body.objective,
      ...(body.title ? { title: body.title } : {}),
      userId: user.id,
      ...(body.routingPolicy ? { routingPolicy: body.routingPolicy } : {}),
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
    });

    return jsonOk({ run: serialiseRun(run) }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export function serialiseRun(run: typeof schema.agentRuns.$inferSelect) {
  return {
    id: run.id,
    projectId: run.projectId,
    goalId: run.goalId,
    conversationId: run.conversationId,
    title: run.title,
    objective: run.objective,
    status: run.status,
    phase: run.phase,
    controlSignal: run.controlSignal,
    routingPolicy: run.routingPolicy,
    error: run.error,
    resultSummary: run.resultSummary,
    checkpoint: run.checkpoint,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    costUsd: run.costUsd,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}
