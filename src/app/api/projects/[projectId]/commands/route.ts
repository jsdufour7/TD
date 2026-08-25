import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { jsonError, jsonOk, parseQuery } from '@/lib/api';
import { cancelCommand } from '@/engine/command-runner';

const querySchema = z.object({
  commandId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Terminal history. Output is persisted, so this works after a refresh. */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const query = parseQuery(new URL(request.url), querySchema);
    const db = await getDb();

    const commands = await db
      .select()
      .from(schema.commands)
      .where(eq(schema.commands.projectId, projectId))
      .orderBy(desc(schema.commands.startedAt))
      .limit(query.limit);

    const filtered = query.commandId ? commands.filter((c) => c.id === query.commandId) : commands;

    return jsonOk({
      commands: filtered.map((command) => ({
        id: command.id,
        label: command.label,
        argv: command.argv,
        cwd: command.cwd,
        kind: command.kind,
        status: command.status,
        exitCode: command.exitCode,
        stdout: command.stdout,
        stderr: command.stderr,
        previewUrl: command.previewUrl,
        durationMs: command.durationMs,
        startedAt: command.startedAt.toISOString(),
        finishedAt: command.finishedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** Cancel a running command, including a long-lived dev server. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const query = parseQuery(new URL(request.url), querySchema);
    if (!query.commandId) return jsonError(new Error('commandId is required'));

    const db = await getDb();
    const rows = await db
      .select()
      .from(schema.commands)
      .where(eq(schema.commands.id, query.commandId))
      .limit(1);
    // Isolation: only a command belonging to this project may be cancelled.
    if (!rows[0] || rows[0].projectId !== projectId) {
      return jsonError(new Error('Command not found in this project'));
    }

    const wasLive = await cancelCommand(query.commandId);
    return jsonOk({ ok: true, wasLive });
  } catch (error) {
    return jsonError(error);
  }
}
