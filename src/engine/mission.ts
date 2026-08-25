import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { transitionObjective } from './objectives';
import { createRun } from './run-engine';
import { emitAndNotify } from './events';
import { createLogger } from '@/lib/logger';

const log = createLogger('mission');

/**
 * Mission Mode supervisor (§6, §7).
 *
 * Called after every run finalises. If the run belongs to an objective whose
 * autonomy mode is `autonomous` or `mission`, the supervisor evaluates whether
 * the objective is actually done and, if not, re-plans and launches a follow-up
 * run — continuing until DONE / BLOCKED / NEEDS_USER / BUDGET / MAX_ITERATIONS.
 *
 * It never loops unboundedly: iteration count, budget and a "needs a human"
 * detector all terminate the loop, and a run is never relaunched for an
 * objective that is already complete.
 */

const MAX_ITERATIONS = 5;

type Supervision = {
  action: 'completed' | 'continue' | 'blocked' | 'awaiting_user' | 'budget' | 'max_iterations';
  detail: string;
};

export async function superviseObjective(objectiveId: string): Promise<Supervision | null> {
  const db = await getDb();

  const objective = (await db.select().from(schema.objectives).where(eq(schema.objectives.id, objectiveId)).limit(1))[0];
  if (!objective) return null;
  if (objective.autonomyMode !== 'mission' && objective.autonomyMode !== 'autonomous') return null;
  if (!['active', 'blocked', 'failed'].includes(objective.status)) return null;

  const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.objectiveId, objectiveId));
  if (tasks.length === 0) return null;

  const completed = tasks.filter((t) => t.status === 'completed');
  const failed = tasks.filter((t) => t.status === 'failed');
  const blocked = tasks.filter((t) => t.status === 'blocked');

  // A block that genuinely needs a human (e.g. no provider, a permission, a
  // decision) must stop the mission and surface the question.
  const needsHuman = blocked.filter((t) =>
    /provider|permission|approval|decision|humain|human|credential|secret/i.test(t.blockedReason ?? ''),
  );

  const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.objectiveId, objectiveId));
  const iterations = runs.length;

  const spent = await db
    .select({ cost: sql<string>`COALESCE(SUM(${schema.agentRuns.costUsd}::numeric), 0)::text` })
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.objectiveId, objectiveId));
  const spentUsd = Number.parseFloat(spent[0]?.cost ?? '0') || 0;
  const budgetUsd = objective.budgetUsd ? Number.parseFloat(objective.budgetUsd) : null;

  const emit = (type: string, summary: string, level: 'info' | 'success' | 'warning' | 'error' = 'info') =>
    emitAndNotify({
      runId: '',
      projectId: objective.projectId,
      type: type as never,
      level,
      actor: 'coo',
      summary,
      payload: { objectiveId, iterations, spentUsd },
    }).catch(() => undefined);

  // DONE
  if (failed.length === 0 && blocked.length === 0 && completed.length === tasks.length) {
    await transitionObjective(objectiveId, 'completed', 'coo').catch(() => undefined);
    await emit('run.completed', `Objective "${objective.title}" completed after ${iterations} run(s).`, 'success');
    return { action: 'completed', detail: `${completed.length}/${tasks.length} tasks completed` };
  }

  // NEEDS_USER
  if (needsHuman.length > 0) {
    await transitionObjective(objectiveId, 'awaiting_user', 'coo').catch(() => undefined);
    const why = needsHuman[0]!.blockedReason ?? 'a decision is required';
    await emit('approval.requested', `Objective "${objective.title}" needs a human decision: ${why}`, 'warning');
    return { action: 'awaiting_user', detail: why };
  }

  // BUDGET
  if (budgetUsd !== null && spentUsd >= budgetUsd) {
    await transitionObjective(objectiveId, 'blocked', 'coo').catch(() => undefined);
    await emit('run.failed', `Objective "${objective.title}" paused: budget $${spentUsd.toFixed(2)} reached.`, 'warning');
    return { action: 'budget', detail: `spent $${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}` };
  }

  // MAX_ITERATIONS
  if (iterations >= MAX_ITERATIONS) {
    await transitionObjective(objectiveId, 'blocked', 'coo').catch(() => undefined);
    await emit('run.failed', `Objective "${objective.title}" stopped after ${iterations} iterations.`, 'warning');
    return { action: 'max_iterations', detail: `${iterations} runs` };
  }

  // CONTINUE: re-plan the incomplete/failed work into a fresh run.
  const incomplete = [...failed, ...blocked];
  if (incomplete.length === 0) {
    // Some tasks still running/queued; do not launch a duplicate run.
    return { action: 'continue', detail: 'work still in flight' };
  }

  const maxVersion = (
    await db
      .select({ v: sql<number>`COALESCE(MAX(${schema.plans.version}), 0)` })
      .from(schema.plans)
      .where(eq(schema.plans.objectiveId, objectiveId))
  )[0]!.v;

  const [plan] = await db
    .insert(schema.plans)
    .values({
      objectiveId,
      projectId: objective.projectId,
      version: maxVersion + 1,
      rationale: `Replan after run ${iterations}: ${failed.length} failed, ${blocked.length} blocked.`,
      status: 'executing',
    })
    .returning();

  const run = await createRun({
    projectId: objective.projectId,
    objective: objective.title,
    title: `Mission (v${plan!.version}): ${objective.title.slice(0, 60)}`,
    userId: objective.createdByUserId ?? undefined,
  });
  await db.update(schema.agentRuns).set({ objectiveId }).where(eq(schema.agentRuns.id, run.id));

  for (const task of incomplete) {
    await db.insert(schema.tasks).values({
      projectId: objective.projectId,
      runId: run.id,
      objectiveId,
      planId: plan!.id,
      parentTaskId: task.id,
      title: `Retry: ${task.title}`,
      status: 'backlog',
      assignedAgentDefinitionKey: task.assignedAgentDefinitionKey,
      createdByType: 'coo',
      generationReason: `replan after ${task.status}: ${task.blockedReason ?? task.outputSummary ?? ''}`.slice(0, 300),
      acceptanceCriteria: task.acceptanceCriteria,
      verificationStrategy: task.verificationStrategy,
    });
  }

  await transitionObjective(objectiveId, 'active', 'coo').catch(() => undefined);
  await emit('run.phase', `COO replanned "${objective.title}" (v${plan!.version}): ${incomplete.length} corrective task(s) → run ${run.id.slice(0, 8)}.`, 'info');
  log.info('mission continue', { objectiveId, iteration: iterations + 1, corrective: incomplete.length });

  return { action: 'continue', detail: `replan v${plan!.version} with ${incomplete.length} corrective task(s)` };
}
