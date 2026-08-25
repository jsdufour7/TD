import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { AppError } from '@/lib/errors';
import { OBJECTIVE_STATUSES, type ObjectiveStatus, type AutonomyMode } from '@/db/schema/objectives';
import { emitAndNotify } from './events';

/**
 * Objective state machine (§25).
 *
 * Transitions are validated so an objective can never jump to an illegal state,
 * and every transition emits an event so the live feed reflects it.
 */

const TRANSITIONS: Record<ObjectiveStatus, ObjectiveStatus[]> = {
  draft: ['planning', 'cancelled'],
  planning: ['active', 'cancelled'],
  active: ['paused', 'blocked', 'awaiting_user', 'completed', 'failed', 'cancelled'],
  paused: ['active', 'cancelled'],
  blocked: ['active', 'cancelled'],
  awaiting_user: ['active', 'cancelled'],
  completed: [],
  failed: ['active', 'cancelled'],
  cancelled: [],
};

export function isValidTransition(from: ObjectiveStatus, to: ObjectiveStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export async function transitionObjective(
  objectiveId: string,
  to: ObjectiveStatus,
  actor: string = 'system',
): Promise<typeof schema.objectives.$inferSelect> {
  const db = await getDb();
  const rows = await db.select().from(schema.objectives).where(eq(schema.objectives.id, objectiveId)).limit(1);
  const objective = rows[0];
  if (!objective) throw new AppError('not_found', 'Objective not found');

  const from = objective.status as ObjectiveStatus;
  if (from === to) return objective;
  if (!isValidTransition(from, to)) {
    throw new AppError('conflict', `Invalid objective transition: ${from} → ${to}`);
  }

  const [updated] = await db
    .update(schema.objectives)
    .set({
      status: to,
      ...(to === 'active' && !objective.startedAt ? { startedAt: new Date() } : {}),
      ...(to === 'completed' || to === 'failed' || to === 'cancelled' ? { completedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.objectives.id, objectiveId))
    .returning();

  await emitAndNotify({
    runId: '',
    projectId: objective.projectId,
    type: to === 'awaiting_user' ? ('approval.requested' as never) : ('run.phase' as never),
    level: to === 'failed' ? 'error' : to === 'blocked' ? 'warning' : 'info',
    actor,
    summary: `Objective "${objective.title}": ${from} → ${to}`,
    payload: { objectiveId, from, to },
  }).catch(() => undefined);

  return updated!;
}

export async function createObjective(input: {
  projectId: string;
  title: string;
  description?: string;
  source?: string;
  autonomyMode?: AutonomyMode;
  createdByUserId?: string | null;
  successCriteria?: string[];
  priority?: number;
}) {
  const db = await getDb();
  const [objective] = await db
    .insert(schema.objectives)
    .values({
      projectId: input.projectId,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      source: input.source ?? 'user',
      autonomyMode: input.autonomyMode ?? 'approval',
      createdByUserId: input.createdByUserId ?? null,
      successCriteria: input.successCriteria ?? [],
      priority: input.priority ?? 3,
      status: 'draft',
    })
    .returning();
  return objective!;
}

export { OBJECTIVE_STATUSES };
