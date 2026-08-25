import { z } from 'zod';
import { createTwoFilesPatch } from 'diff';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { jsonError, jsonOk, parseQuery } from '@/lib/api';

const querySchema = z.object({
  runId: z.string().uuid().optional(),
  path: z.string().optional(),
});

/**
 * Diff / Review Center (§31).
 *
 * Diffs are computed server-side from the recorded before/after snapshots, so
 * changes stay inspectable after the run has ended and after a refresh — they
 * are never buried inside chat messages.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const query = parseQuery(new URL(request.url), querySchema);
    const db = await getDb();

    const conditions = [eq(schema.gitChanges.projectId, projectId)];
    if (query.runId) conditions.push(eq(schema.gitChanges.runId, query.runId));
    if (query.path) conditions.push(eq(schema.gitChanges.path, query.path));

    const changes = await db
      .select()
      .from(schema.gitChanges)
      .where(and(...conditions))
      .orderBy(desc(schema.gitChanges.createdAt));

    const enriched = changes.map((change) => {
      const patch = createTwoFilesPatch(
        `a/${change.path}`,
        `b/${change.path}`,
        change.beforeContent ?? '',
        change.afterContent ?? '',
        '',
        '',
        { context: 3 },
      );
      return {
        id: change.id,
        runId: change.runId,
        taskId: change.taskId,
        agentInstanceId: change.agentInstanceId,
        path: change.path,
        changeType: change.changeType,
        additions: change.additions,
        deletions: change.deletions,
        diff: patch,
        createdAt: change.createdAt.toISOString(),
      };
    });

    const totals = enriched.reduce(
      (acc, c) => ({
        added: acc.added + (c.changeType === 'added' ? 1 : 0),
        modified: acc.modified + (c.changeType === 'modified' ? 1 : 0),
        deleted: acc.deleted + (c.changeType === 'deleted' ? 1 : 0),
        additions: acc.additions + c.additions,
        deletions: acc.deletions + c.deletions,
      }),
      { added: 0, modified: 0, deleted: 0, additions: 0, deletions: 0 },
    );

    return jsonOk({ changes: enriched, totals });
  } catch (error) {
    return jsonError(error);
  }
}
