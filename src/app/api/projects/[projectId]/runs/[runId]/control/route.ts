import { z } from 'zod';
import { requireProject, requireUser } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { sendControlSignal } from '@/engine/run-engine';

const schema = z.object({ signal: z.enum(['pause', 'resume', 'cancel']) });

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; runId: string }> },
): Promise<Response> {
  try {
    const { projectId, runId } = await context.params;
    await requireProject(projectId);
    const user = await requireUser();
    const body = await parseBody(request, schema);

    await sendControlSignal(runId, projectId, body.signal, user.id);
    return jsonOk({ ok: true, signal: body.signal });
  } catch (error) {
    return jsonError(error);
  }
}
