import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { handleCooMessage } from '@/engine/coo';
import { recordAudit } from '@/lib/audit';
import type { AutonomyMode } from '@/db/schema/objectives';

const sendSchema = z.object({
  content: z.string().min(1).max(20000),
  autonomyMode: z.enum(['manual', 'approval', 'autonomous', 'mission']).default('approval'),
});

/**
 * The COO is the primary entry point. A message either produces an answer or an
 * executed objective/plan/run. Everything lands in the project's COO thread so
 * the conversation and the operations share one persistent history.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const user = await requireProject(projectId);
    const body = await parseBody(request, sendSchema);
    const db = await getDb();

    // One persistent COO thread per project.
    let thread = (
      await db.select().from(schema.conversations).where(eq(schema.conversations.projectId, projectId)).orderBy(asc(schema.conversations.createdAt)).limit(1)
    )[0];
    if (!thread) {
      thread = (
        await db.insert(schema.conversations).values({ projectId, title: 'COO', participants: ['coo'] }).returning()
      )[0]!;
    }

    await db.insert(schema.messages).values({
      conversationId: thread.id,
      projectId,
      role: 'user',
      authorName: user.name,
      content: body.content,
    });

    const result = await handleCooMessage({
      projectId,
      text: body.content,
      userId: user.id,
      autonomyMode: body.autonomyMode as AutonomyMode,
    });

    const [stored] = await db
      .insert(schema.messages)
      .values({
        conversationId: thread.id,
        projectId,
        role: 'agent',
        authorName: 'AI COO',
        content: result.kind === 'answer' ? result.content : result.report,
        metadata: {
          agentKey: 'coo',
          mode: result.kind === 'answer' ? result.mode : 'executed',
          ...(result.kind === 'executed'
            ? { objectiveId: result.objectiveId, planId: result.planId, runId: result.runId }
            : {}),
        },
      })
      .returning();

    await recordAudit({
      action: 'coo.message',
      organizationId: user.organizationId,
      projectId,
      userId: user.id,
      entityType: 'conversation',
      entityId: thread.id,
      metadata: { kind: result.kind, autonomyMode: body.autonomyMode },
    });

    return jsonOk({
      message: {
        id: stored!.id,
        role: 'agent',
        authorName: 'AI COO',
        content: result.kind === 'answer' ? result.content : result.report,
      },
      result:
        result.kind === 'executed'
          ? { kind: 'executed', objectiveId: result.objectiveId, planId: result.planId, runId: result.runId, tasks: result.tasks }
          : { kind: 'answer', mode: result.mode },
    });
  } catch (error) {
    return jsonError(error);
  }
}
