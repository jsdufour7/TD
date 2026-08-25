import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject, requireEntityInProject } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { replyAsAgent } from '@/agents/assistant';
import { getAgentDefinition } from '@/agents/catalog';
import { recordAudit } from '@/lib/audit';

const sendSchema = z.object({
  content: z.string().min(1).max(20000),
});

/**
 * Send a user message into a thread and collect the replies.
 *
 * A thread with no participants is a one-on-one with the COO. A thread with
 * participants is a meeting room: each convened agent answers in its role,
 * seeing the user's message and the previous agents' contributions, so the
 * discussion builds. Every message — user and agent — is persisted.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; cid: string }> },
): Promise<Response> {
  try {
    const { projectId, cid } = await context.params;
    const user = await requireProject(projectId);
    const body = await parseBody(request, sendSchema);
    const db = await getDb();

    const conversation = (await db.select().from(schema.conversations).where(eq(schema.conversations.id, cid)).limit(1))[0];
    await requireEntityInProject(projectId, conversation, 'conversation');

    // Store the user's message.
    await db.insert(schema.messages).values({
      conversationId: cid,
      projectId,
      role: 'user',
      authorName: user.name,
      content: body.content,
    });

    const participants = conversation!.participants.length > 0 ? conversation!.participants : ['coo'];

    const history: Array<{ role: string; authorName: string | null; content: string }> = (
      await db.select().from(schema.messages).where(eq(schema.messages.conversationId, cid)).orderBy(asc(schema.messages.createdAt))
    ).map((m) => ({ role: m.role, authorName: m.authorName, content: m.content }));

    const newMessages: Array<Record<string, unknown>> = [];

    for (const agentKey of participants) {
      const definition = getAgentDefinition(agentKey);
      const reply = await replyAsAgent({
        agentKey,
        projectId,
        userText: body.content,
        history,
      });

      const [stored] = await db
        .insert(schema.messages)
        .values({
          conversationId: cid,
          projectId,
          role: 'agent',
          authorName: definition?.name ?? agentKey,
          content: reply.content,
          metadata: { agentKey, mode: reply.mode, ...(reply.providerKey ? { providerKey: reply.providerKey } : {}) },
        })
        .returning();

      // The next agent sees this one's contribution, so the meeting builds.
      history.push({ role: 'agent', authorName: definition?.name ?? agentKey, content: reply.content });

      newMessages.push({
        id: stored!.id,
        role: 'agent',
        authorName: stored!.authorName,
        agentKey,
        mode: reply.mode,
        content: reply.content,
        createdAt: stored!.createdAt.toISOString(),
      });
    }

    await db.update(schema.conversations).set({ updatedAt: new Date() }).where(eq(schema.conversations.id, cid));

    await recordAudit({
      action: 'chat.message.send',
      organizationId: user.organizationId,
      projectId,
      userId: user.id,
      entityType: 'conversation',
      entityId: cid,
      metadata: { participants },
    });

    return jsonOk({ messages: newMessages });
  } catch (error) {
    return jsonError(error);
  }
}
