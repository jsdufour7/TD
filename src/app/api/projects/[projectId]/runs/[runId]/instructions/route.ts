import { z } from 'zod';
import { requireProject, requireUser } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { sendRunInstruction } from '@/engine/run-engine';

const schema = z.object({ instruction: z.string().min(3).max(20000) });

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; runId: string }> },
): Promise<Response> {
  try {
    const { projectId, runId } = await context.params;
    await requireProject(projectId);
    const user = await requireUser();
    const body = await parseBody(request, schema);

    await sendRunInstruction(runId, projectId, body.instruction, user.id);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
