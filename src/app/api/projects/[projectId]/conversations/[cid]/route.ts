import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject, requireEntityInProject } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';

/** Load a thread (conversation + its messages), organisation-scoped. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; cid: string }> },
): Promise<Response> {
  try {
    const { projectId, cid } = await context.params;
    await requireProject(projectId);
    const db = await getDb();

    const conversation = (await db.select().from(schema.conversations).where(eq(schema.conversations.id, cid)).limit(1))[0];
    await requireEntityInProject(projectId, conversation, 'conversation');

    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, cid))
      .orderBy(asc(schema.messages.createdAt));

    return jsonOk({
      conversation: {
        id: conversation!.id,
        title: conversation!.title,
        participants: conversation!.participants,
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        authorName: m.authorName,
        agentKey: (m.metadata as { agentKey?: string } | null)?.agentKey ?? null,
        mode: (m.metadata as { mode?: string } | null)?.mode ?? null,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
