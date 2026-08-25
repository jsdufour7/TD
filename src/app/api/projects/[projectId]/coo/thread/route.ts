import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';

/** The persistent COO thread for a project. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const db = await getDb();

    const thread = (
      await db.select().from(schema.conversations).where(eq(schema.conversations.projectId, projectId)).orderBy(asc(schema.conversations.createdAt)).limit(1)
    )[0];

    if (!thread) return jsonOk({ thread: null, messages: [] });

    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, thread.id))
      .orderBy(asc(schema.messages.createdAt));

    return jsonOk({
      thread: { id: thread.id, title: thread.title },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        authorName: m.authorName,
        content: m.content,
        mode: (m.metadata as { mode?: string } | null)?.mode ?? null,
        runId: (m.metadata as { runId?: string } | null)?.runId ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
