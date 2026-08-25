import { sql } from 'drizzle-orm';
import { getDb, schema, type Tx } from '@/db/client';

/**
 * Run event stream (§17).
 *
 * The live feed is *derived* from these rows. Nothing in the UI invents activity
 * and nothing is driven by a timer. Sequence numbers are allocated inside the
 * INSERT so concurrent emitters cannot collide, which lets the SSE endpoint
 * resume from `?after=<seq>` without gaps or duplicates.
 */

export type RunEventType =
  | 'run.created'
  | 'run.queued'
  | 'run.started'
  | 'run.paused'
  | 'run.resumed'
  | 'run.cancelled'
  | 'run.completed'
  | 'run.failed'
  | 'run.phase'
  | 'run.recovered'
  | 'plan.created'
  | 'goal.created'
  | 'task.created'
  | 'task.updated'
  | 'task.assigned'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.blocked'
  | 'agent.started'
  | 'agent.progress'
  | 'agent.completed'
  | 'agent.failed'
  | 'model.called'
  | 'model.failed'
  | 'context.assembled'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.denied'
  | 'file.changed'
  | 'command.started'
  | 'command.output'
  | 'command.completed'
  | 'command.failed'
  | 'test.started'
  | 'test.passed'
  | 'test.failed'
  | 'preview.started'
  | 'preview.error'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'checkpoint.created'
  | 'memory.recorded'
  | 'artifact.created'
  | 'repo.inspected'
  | 'user.message';

export type EventLevel = 'info' | 'success' | 'warning' | 'error';

export type RunEventInput = {
  runId: string;
  projectId: string;
  type: RunEventType;
  summary: string;
  level?: EventLevel;
  actor?: string;
  agentInstanceId?: string | null;
  taskId?: string | null;
  payload?: Record<string, unknown>;
};

/**
 * Append a run event. Returns the allocated sequence number.
 *
 * Accepts an optional transaction so a tool that mutates data can emit its event
 * atomically with the mutation — if the mutation rolls back, the event does too.
 */
export async function emitRunEvent(input: RunEventInput, tx?: Tx): Promise<number> {
  const payload = {
    runId: input.runId,
    projectId: input.projectId,
    seq: 0,
    type: input.type,
    level: input.level ?? 'info',
    actor: input.actor ?? 'system',
    agentInstanceId: input.agentInstanceId ?? null,
    taskId: input.taskId ?? null,
    summary: input.summary,
    payload: input.payload ?? null,
  };

  if (tx) {
    const inserted = await tx
      .insert(schema.runEvents)
      .values({
        ...payload,
        seq: sql`(SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id = ${input.runId})`,
      })
      .returning({ seq: schema.runEvents.seq });
    return inserted[0]?.seq ?? 0;
  }

  const db = await getDb();
  const inserted = await db
    .insert(schema.runEvents)
    .values({
      ...payload,
      seq: sql`(SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id = ${input.runId})`,
    })
    .returning({ seq: schema.runEvents.seq });
  return inserted[0]?.seq ?? 0;
}

/**
 * Wake every SSE subscriber for a project after an event is committed.
 * Kept deliberately separate from the write path so persistence is never
 * dependent on a listener existing.
 */
type Listener = (projectId: string) => void;
const listeners = new Set<Listener>();

export function subscribeToProjectEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyProjectChanged(projectId: string): void {
  for (const listener of listeners) {
    try {
      listener(projectId);
    } catch {
      // A broken subscriber must not break the run engine.
    }
  }
}

/** Emit + notify in one call, for the common path. */
export async function emitAndNotify(input: RunEventInput, tx?: Tx): Promise<number> {
  const seq = await emitRunEvent(input, tx);
  notifyProjectChanged(input.projectId);
  return seq;
}

export function serialiseRunEvent(event: {
  id: string;
  seq: number;
  type: string;
  level: string;
  actor: string;
  summary: string;
  payload: unknown;
  agentInstanceId: string | null;
  taskId: string | null;
  createdAt: Date;
}) {
  return {
    id: event.id,
    seq: event.seq,
    type: event.type,
    level: event.level,
    actor: event.actor,
    summary: event.summary,
    payload: event.payload,
    agentInstanceId: event.agentInstanceId,
    taskId: event.taskId,
    createdAt: event.createdAt.toISOString(),
  };
}
