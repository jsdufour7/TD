import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject, requireUser } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { recordAudit } from '@/lib/audit';

const createSchema = z.object({
  kind: z.enum(['canonical', 'working', 'decision', 'execution', 'preference']),
  title: z.string().min(3).max(200),
  content: z.string().min(1).max(50000),
  tags: z.array(z.string()).default([]),
  isPinned: z.boolean().optional(),
});

const MEMORY_KINDS = ['canonical', 'working', 'decision', 'execution', 'preference'] as const;

/** Project memory (§9). Separated by kind so retrieval can be selective. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const db = await getDb();

    const memories = await db
      .select()
      .from(schema.memories)
      .where(and(eq(schema.memories.projectId, projectId), inArray(schema.memories.kind, [...MEMORY_KINDS])))
      .orderBy(desc(schema.memories.isPinned), desc(schema.memories.updatedAt));

    const grouped: Record<string, unknown[]> = {};
    for (const kind of MEMORY_KINDS) grouped[kind] = [];
    for (const memory of memories) {
      grouped[memory.kind]?.push({
        id: memory.id,
        title: memory.title,
        content: memory.content,
        tags: memory.tags,
        confidence: memory.confidence,
        isPinned: memory.isPinned,
        source: memory.source,
        runId: memory.runId,
        createdAt: memory.createdAt.toISOString(),
        updatedAt: memory.updatedAt.toISOString(),
      });
    }

    return jsonOk({ memories: grouped, total: memories.length });
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
    const user = await requireUser();
    const body = await parseBody(request, createSchema);
    const db = await getDb();

    const [memory] = await db
      .insert(schema.memories)
      .values({
        projectId,
        kind: body.kind,
        title: body.title,
        content: body.content,
        tags: body.tags,
        source: 'user',
        isPinned: body.isPinned ?? body.kind === 'canonical',
      })
      .returning();

    await recordAudit({
      action: 'memory.create',
      projectId,
      userId: user.id,
      entityType: 'memory',
      entityId: memory!.id,
      metadata: { kind: body.kind },
    });

    return jsonOk({ memory: memory! }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
