import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { AGENT_KEYS } from '@/agents/catalog';

const createSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  participants: z.array(z.string()).max(8).optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const db = await getDb();

    const conversations = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.projectId, projectId))
      .orderBy(desc(schema.conversations.updatedAt));

    return jsonOk({
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        participants: c.participants,
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const body = await parseBody(request, createSchema);
    const db = await getDb();

    // Validate participant keys against the catalog so a thread can only
    // convene real agents.
    const participants = (body.participants ?? []).filter((k) => AGENT_KEYS.includes(k));

    const [conversation] = await db
      .insert(schema.conversations)
      .values({
        projectId,
        title: body.title ?? (participants.length > 0 ? 'Salle de réunion' : 'Discussion avec le COO'),
        participants,
      })
      .returning();

    return jsonOk(
      { conversation: { id: conversation!.id, title: conversation!.title, participants: conversation!.participants } },
      201,
    );
  } catch (error) {
    return jsonError(error);
  }
}
