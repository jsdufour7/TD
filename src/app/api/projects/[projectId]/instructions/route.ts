import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject, requireUser } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { recordAudit } from '@/lib/audit';

const createSchema = z.object({
  kind: z.enum(['product', 'technical', 'design', 'workflow']),
  title: z.string().min(2).max(200),
  content: z.string().min(1).max(50000),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const db = await getDb();
    const instructions = await db
      .select()
      .from(schema.projectInstructions)
      .where(eq(schema.projectInstructions.projectId, projectId));
    return jsonOk({ instructions });
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

    const [instruction] = await db
      .insert(schema.projectInstructions)
      .values({ projectId, kind: body.kind, title: body.title, content: body.content })
      .returning();

    await recordAudit({
      action: 'project_instruction.create',
      projectId,
      userId: user.id,
      entityType: 'project_instruction',
      entityId: instruction!.id,
    });

    return jsonOk({ instruction }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const user = await requireUser();
    const body = await parseBody(request, patchSchema);
    const db = await getDb();

    // Scope the update by project as well as id: a client cannot toggle an
    // instruction belonging to a different project.
    const updated = await db
      .update(schema.projectInstructions)
      .set({ isActive: body.isActive })
      .where(and(eq(schema.projectInstructions.id, body.id), eq(schema.projectInstructions.projectId, projectId)))
      .returning();

    if (updated.length === 0) return jsonError(new Error('Instruction not found in this project'));

    await recordAudit({
      action: 'project_instruction.toggle',
      projectId,
      userId: user.id,
      entityType: 'project_instruction',
      entityId: body.id,
      metadata: { isActive: body.isActive },
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
