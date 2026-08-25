import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';

/**
 * Run checkpoints (§18).
 *
 * A checkpoint is a durable snapshot of where a run got to: its phase, a summary
 * of the step that produced it, and the status of every task at that moment.
 *
 * This lives in its own module so the planner and the run engine can both write
 * checkpoints without importing each other.
 */
export async function writeCheckpoint(
  runId: string,
  projectId: string,
  label: string,
  phase: string,
  state: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();

  const tasks = await db
    .select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status })
    .from(schema.tasks)
    .where(eq(schema.tasks.runId, runId));

  await db.insert(schema.runCheckpoints).values({
    runId,
    projectId,
    label,
    phase,
    state: {
      ...state,
      taskSnapshot: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      at: new Date().toISOString(),
    },
  });

  await db
    .update(schema.agentRuns)
    .set({ checkpoint: { label, phase, ...state }, updatedAt: new Date() })
    .where(eq(schema.agentRuns.id, runId));
}
