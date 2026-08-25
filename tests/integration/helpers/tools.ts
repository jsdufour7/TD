import { getDb, schema } from '@/db/client';
import { buildToolContext } from '@/engine/tool-context';
import { emitAndNotify } from '@/engine/events';
import type { ToolContext } from '@/tools/types';

/**
 * A ToolContext for tests, wired to the real database and the real event and
 * file-change writers — the same code path production uses.
 */
export async function buildTestToolContext(
  projectId: string,
  sandboxRoot: string,
  permissions: Set<string>,
  opts: { runId?: string | null; agentInstanceId?: string | null } = {},
): Promise<ToolContext> {
  const db = await getDb();

  let runId = opts.runId ?? null;
  if (!runId) {
    const [run] = await db
      .insert(schema.agentRuns)
      .values({ projectId, title: 'tool test run', objective: 'exercise tools', status: 'running' })
      .returning();
    runId = run!.id;
  }

  return buildToolContext({
    projectId,
    runId,
    agentInstanceId: opts.agentInstanceId ?? null,
    sandboxRoot,
    permissions,
    isCancelled: () => false,
  });
}

export { emitAndNotify };
