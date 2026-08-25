import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { env } from '@/lib/env';
import { notFound } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { ensureProjectWorkspaceSandbox } from '@/lib/sandbox';
import { recordAudit } from '@/lib/audit';
import { emitAndNotify } from './events';
import { planRun, readyTasks } from './planner';
import { executeTask } from './agent-executor';
import { writeCheckpoint } from './checkpoints';
import { stopProjectDevServers } from './command-runner';

const log = createLogger('run-engine');

/**
 * Run engine (§17, §18).
 *
 * A run is a durable row, not a promise held in memory. The worker claims queued
 * runs, moves them through the lifecycle, and writes checkpoints at each phase.
 * If the process dies mid-run, `recoverStalledRuns` finds it on the next boot
 * and the orchestrator continues from the checkpoint instead of starting over.
 *
 * The browser is never the source of truth: refresh the page and the run is
 * still there, still running, with its full event history.
 */

export const RUN_PHASES = [
  'understand',
  'gather_context',
  'plan',
  'execute',
  'verify',
  'repair',
  'review',
  'deliver',
  'remember',
] as const;

export type RunPhase = (typeof RUN_PHASES)[number];

type RunRow = typeof schema.agentRuns.$inferSelect;

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export async function createRun(input: {
  projectId: string;
  objective: string;
  title?: string;
  userId?: string | null;
  routingPolicy?: string;
  conversationId?: string | null;
}): Promise<RunRow> {
  const db = await getDb();

  const title =
    input.title ??
    (input.objective.length > 70 ? `${input.objective.slice(0, 67)}…` : input.objective);

  const [goal] = await db
    .insert(schema.goals)
    .values({
      projectId: input.projectId,
      title,
      objective: input.objective,
      status: 'in_progress',
      createdByUserId: input.userId ?? null,
    })
    .returning();

  const [run] = await db
    .insert(schema.agentRuns)
    .values({
      projectId: input.projectId,
      goalId: goal!.id,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      title,
      objective: input.objective,
      status: env.runEngine.enabled ? 'queued' : 'paused',
      phase: 'understand',
      requestedByUserId: input.userId ?? null,
      routingPolicy: input.routingPolicy ?? 'BALANCED',
    })
    .returning();

  await emitAndNotify({
    runId: run!.id,
    projectId: input.projectId,
    type: 'run.created',
    summary: `Run created: ${title}`,
    actor: 'user',
    payload: { goalId: goal!.id, routingPolicy: run!.routingPolicy },
  });

  await recordAudit({
    action: 'run.create',
    projectId: input.projectId,
    userId: input.userId ?? null,
    entityType: 'agent_run',
    entityId: run!.id,
    metadata: { objective: input.objective.slice(0, 500) },
  });

  // Nudge the worker so a queued run starts immediately rather than waiting
  // for the next poll tick.
  wakeWorker();

  return run!;
}

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

/**
 * Request a control transition. The worker honours it at the next safe boundary
 * — between tasks, never in the middle of a file write — which is what makes
 * interruption safe rather than merely immediate (§5, §54).
 */
export async function sendControlSignal(
  runId: string,
  projectId: string,
  signal: 'pause' | 'resume' | 'cancel',
  userId?: string | null,
): Promise<void> {
  const db = await getDb();

  const runs = await db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.id, runId), eq(schema.agentRuns.projectId, projectId)))
    .limit(1);
  const run = runs[0];
  if (!run) throw notFound('Run not found');

  if (signal === 'cancel') {
    await db
      .update(schema.agentRuns)
      .set({ controlSignal: 'cancel', updatedAt: new Date() })
      .where(eq(schema.agentRuns.id, runId));
    // Running tasks and commands stop; the run is finalised by the worker.
    activeRuns.get(runId)?.abortController.abort();
  } else if (signal === 'pause') {
    await db
      .update(schema.agentRuns)
      .set({ controlSignal: 'pause', updatedAt: new Date() })
      .where(eq(schema.agentRuns.id, runId));
  } else {
    await db
      .update(schema.agentRuns)
      .set({ controlSignal: null, status: 'running', updatedAt: new Date() })
      .where(eq(schema.agentRuns.id, runId));
    wakeWorker();
  }

  await emitAndNotify({
    runId,
    projectId,
    type: signal === 'pause' ? 'run.paused' : signal === 'resume' ? 'run.resumed' : 'run.cancelled',
    level: signal === 'cancel' ? 'warning' : 'info',
    actor: 'user',
    summary:
      signal === 'pause'
        ? 'Pause requested — the run will stop at the next safe boundary'
        : signal === 'resume'
          ? 'Run resumed'
          : 'Cancellation requested',
  });

  await recordAudit({
    action: `run.${signal}`,
    projectId,
    userId: userId ?? null,
    entityType: 'agent_run',
    entityId: runId,
  });
}

/** Append an instruction to an in-flight or parked run (§54). */
export async function sendRunInstruction(
  runId: string,
  projectId: string,
  instruction: string,
  userId?: string | null,
): Promise<void> {
  const db = await getDb();
  const runs = await db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.id, runId), eq(schema.agentRuns.projectId, projectId)))
    .limit(1);
  const run = runs[0];
  if (!run) throw notFound('Run not found');

  await db
    .update(schema.agentRuns)
    .set({ objective: `${run.objective}\n\n## Additional instruction\n${instruction}`, updatedAt: new Date() })
    .where(eq(schema.agentRuns.id, runId));

  await db.insert(schema.memories).values({
    projectId,
    kind: 'working',
    title: 'User instruction during run',
    content: instruction,
    source: 'user',
    runId,
    tags: ['instruction'],
  });

  await emitAndNotify({
    runId,
    projectId,
    type: 'user.message',
    actor: 'user',
    summary: `New instruction: ${instruction.slice(0, 160)}`,
    payload: { instruction },
  });

  await recordAudit({
    action: 'run.instruct',
    projectId,
    userId: userId ?? null,
    entityType: 'agent_run',
    entityId: runId,
    metadata: { instruction: instruction.slice(0, 500) },
  });

  wakeWorker();
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

type ActiveRun = { abortController: AbortController; cancelled: boolean; paused: boolean };
const activeRuns = new Map<string, ActiveRun>();

const workerState = globalThis as unknown as {
  __aiCoreWorker?: { running: boolean; timer: NodeJS.Timeout | null; inflight: number };
};
const worker = (workerState.__aiCoreWorker ??= { running: false, timer: null, inflight: 0 });

function wakeWorker(): void {
  if (worker.timer) {
    clearTimeout(worker.timer);
    worker.timer = null;
  }
  void workerLoop();
}

/** Start the background worker. Safe to call more than once. */
export function startRunWorker(): void {
  if (worker.running) return;
  if (!env.runEngine.enabled) {
    log.info('run engine disabled by configuration');
    return;
  }
  worker.running = true;
  log.info('run engine worker started');
  // Anything left running by a previous process is recovered before new work.
  void recoverStalledRuns().catch((error) =>
    log.error('recovery failed', { error: error instanceof Error ? error.message : String(error) }),
  );
  void workerLoop();
}

export function stopRunWorker(): void {
  worker.running = false;
  if (worker.timer) clearTimeout(worker.timer);
  worker.timer = null;
}

async function workerLoop(): Promise<void> {
  if (!worker.running) return;

  try {
    while (worker.running && worker.inflight < env.runEngine.concurrency) {
      const run = await claimNextRun();
      if (!run) break;
      worker.inflight += 1;
      void executeRunGuarded(run).finally(() => {
        worker.inflight -= 1;
        wakeWorker();
      });
    }
  } catch (error) {
    log.error('worker loop error', { error: error instanceof Error ? error.message : String(error) });
  }

  if (!worker.running) return;
  worker.timer = setTimeout(() => {
    worker.timer = null;
    void workerLoop();
  }, env.runEngine.pollIntervalMs);
}

async function executeRunGuarded(run: RunRow): Promise<void> {
  try {
    await executeRun(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('run failed unexpectedly', { runId: run.id, error: message });
    const db = await getDb();
    await db
      .update(schema.agentRuns)
      .set({ status: 'failed', error: message.slice(0, 2000), finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.agentRuns.id, run.id));
    await emitAndNotify({
      runId: run.id,
      projectId: run.projectId,
      type: 'run.failed',
      level: 'error',
      summary: `Run failed: ${message.slice(0, 200)}`,
    }).catch(() => undefined);
  }
}

/** Claim the oldest queued run. Uses SKIP LOCKED so two workers cannot collide. */
async function claimNextRun(): Promise<RunRow | null> {
  const db = await getDb();

  if (env.database.driver === 'postgres') {
    const rows = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.status, 'queued'))
      .orderBy(asc(schema.agentRuns.createdAt))
      .for('update', { skipLocked: true })
      .limit(1);
    const run = rows[0];
    if (!run) return null;
    await db
      .update(schema.agentRuns)
      .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.agentRuns.id, run.id));
    return { ...run, status: 'running' };
  }

  // PGlite is single-connection, so a plain read-then-update is already atomic
  // with respect to other requests in this process.
  const rows = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.status, 'queued'))
    .orderBy(asc(schema.agentRuns.createdAt))
    .limit(1);
  const run = rows[0];
  if (!run) return null;
  await db
    .update(schema.agentRuns)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.agentRuns.id, run.id));
  return { ...run, status: 'running' };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

async function executeRun(run: RunRow): Promise<void> {
  const db = await getDb();
  const abortController = new AbortController();
  const active: ActiveRun = { abortController, cancelled: false, paused: false };
  activeRuns.set(run.id, active);

  const sandboxRoot = await ensureProjectWorkspaceSandbox(run.projectId);

  const isCancelled = (): boolean => active.cancelled;
  const isPaused = async (): Promise<boolean> => {
    const rows = await db
      .select({ controlSignal: schema.agentRuns.controlSignal, status: schema.agentRuns.status })
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, run.id))
      .limit(1);
    const current = rows[0];
    if (!current) return false;
    if (current.controlSignal === 'cancel') {
      active.cancelled = true;
      abortController.abort();
      return false;
    }
    return current.controlSignal === 'pause' || current.status === 'paused';
  };

  try {
    await emitAndNotify({
      runId: run.id,
      projectId: run.projectId,
      type: 'run.started',
      summary: `Run started: ${run.title}`,
      payload: { phase: 'understand' },
    });

    // Recovery: if a previous attempt left tasks behind, do not re-plan (§18).
    const existingTasks = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.runId, run.id));

    if (existingTasks.length > 0) {
      await emitAndNotify({
        runId: run.id,
        projectId: run.projectId,
        type: 'run.recovered',
        level: 'warning',
        summary: `Resuming an interrupted run — ${existingTasks.length} existing task(s) found, not re-planning`,
        payload: { existingTaskCount: existingTasks.length },
      });
    } else {
      await setPhase(run.id, 'plan');
      const plan = await planRun({
        runId: run.id,
        projectId: run.projectId,
        objective: run.objective,
        sandboxRoot,
        signal: abortController.signal,
        isCancelled,
      });
      await writeCheckpoint(run.id, run.projectId, 'plan-complete', 'plan', {
        mode: plan.mode,
        taskCount: plan.taskCount,
      });
    }

    // --- Execute the task graph -------------------------------------------
    await setPhase(run.id, 'execute');
    let iterations = 0;
    const MAX_ITERATIONS = 200;

    while (iterations < MAX_ITERATIONS) {
      iterations += 1;

      if (active.cancelled || (await isPaused()) || active.cancelled) {
        break;
      }

      const ready = await readyTasks(run.projectId, run.id);
      if (ready.length === 0) break;

      for (const task of ready) {
        if (active.cancelled) break;
        if (await isPaused()) break;

        const outcome = await executeTask({
          projectId: run.projectId,
          runId: run.id,
          task,
          sandboxRoot,
          isCancelled,
          signal: abortController.signal,
        });

        // A failed task triggers the repair loop rather than ending the run (§4).
        if (outcome.status === 'failed' && task.attemptCount + 1 < task.maxAttempts) {
          await setPhase(run.id, 'repair');
          await db
            .update(schema.tasks)
            .set({
              status: 'ready',
              finishedAt: null,
              blockedReason: null,
              updatedAt: new Date(),
            })
            .where(eq(schema.tasks.id, task.id));

          await emitAndNotify({
            runId: run.id,
            projectId: run.projectId,
            type: 'task.updated',
            level: 'warning',
            summary: `Retrying "${task.title}" (attempt ${task.attemptCount + 2} of ${task.maxAttempts})`,
            taskId: task.id,
            payload: { attempt: task.attemptCount + 2, previousError: outcome.summary.slice(0, 300) },
          });

          await db.insert(schema.memories).values({
            projectId: run.projectId,
            kind: 'working',
            title: `Failed attempt on: ${task.title}`,
            content: `Attempt ${task.attemptCount + 1} failed: ${outcome.summary}. Do not repeat this approach.`,
            source: 'run-engine',
            runId: run.id,
            tags: ['failure', 'repair'],
          });
          break; // re-evaluate the ready set after re-queueing
        }

        await writeCheckpoint(run.id, run.projectId, `task-${task.id.slice(0, 8)}`, 'execute', {
          taskId: task.id,
          title: task.title,
          outcome: outcome.status,
          summary: outcome.summary.slice(0, 500),
        });
      }
    }

    // --- Finalise -----------------------------------------------------------
    if (active.cancelled) {
      await finaliseRun(run.id, 'cancelled', 'Cancelled by the user');
      return;
    }
    if (await isPaused()) {
      await db
        .update(schema.agentRuns)
        .set({ status: 'paused', updatedAt: new Date() })
        .where(eq(schema.agentRuns.id, run.id));
      await emitAndNotify({
        runId: run.id,
        projectId: run.projectId,
        type: 'run.paused',
        level: 'warning',
        summary: 'Run paused at a safe boundary. Resume to continue from this point.',
      });
      return;
    }

    await setPhase(run.id, 'remember');
    const summary = await summariseRun(run.id);
    await finaliseRun(run.id, summary.status, summary.text);
  } finally {
    activeRuns.delete(run.id);
  }
}

async function setPhase(runId: string, phase: RunPhase): Promise<void> {
  const db = await getDb();
  await db.update(schema.agentRuns).set({ phase, updatedAt: new Date() }).where(eq(schema.agentRuns.id, runId));
}

/**
 * Build the completion report from real recorded data — task outcomes, file
 * changes and test results — never from the agent's own prose alone.
 *
 * Exported so tests can assert that the report reflects what was recorded.
 */
export async function summariseRun(
  runId: string,
): Promise<{ status: 'completed' | 'failed'; text: string }> {
  const db = await getDb();

  const tasks = await db
    .select({ title: schema.tasks.title, status: schema.tasks.status, output: schema.tasks.outputSummary })
    .from(schema.tasks)
    .where(eq(schema.tasks.runId, runId));

  const changes = await db
    .select({ path: schema.gitChanges.path, changeType: schema.gitChanges.changeType })
    .from(schema.gitChanges)
    .where(eq(schema.gitChanges.runId, runId));

  const tests = await db
    .select({
      suite: schema.testRuns.suite,
      status: schema.testRuns.status,
      passed: schema.testRuns.passed,
      failed: schema.testRuns.failed,
    })
    .from(schema.testRuns)
    .where(eq(schema.testRuns.runId, runId));

  const completed = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const blocked = tasks.filter((t) => t.status === 'blocked').length;

  const lines = [
    `Tasks: ${completed} completed, ${failed} failed, ${blocked} blocked of ${tasks.length}.`,
    changes.length > 0
      ? `Files changed: ${changes.length} (${changes.slice(0, 8).map((c) => c.path).join(', ')}${changes.length > 8 ? ', …' : ''})`
      : 'Files changed: none',
    tests.length > 0
      ? `Verification: ${tests.filter((t) => t.status === 'passed').length}/${tests.length} suites passed`
      : 'Verification: no test runs recorded',
  ];

  if (failed > 0) lines.push('The run did not meet all acceptance criteria — see the failed tasks in the feed.');
  else if (blocked > 0) lines.push('Some tasks are blocked. The blocking reason is recorded on each task.');

  const status = failed > 0 ? 'failed' : 'completed';
  return { status, text: lines.join('\n') };
}

async function finaliseRun(runId: string, status: 'completed' | 'failed' | 'cancelled', summary: string): Promise<void> {
  const db = await getDb();

  const usage = await db
    .select({
      input: sql<number>`COALESCE(SUM(${schema.modelUsages.inputTokens}), 0)`,
      output: sql<number>`COALESCE(SUM(${schema.modelUsages.outputTokens}), 0)`,
      cost: sql<string>`COALESCE(SUM(${schema.modelUsages.costUsd}::numeric), 0)::text`,
    })
    .from(schema.modelUsages)
    .where(eq(schema.modelUsages.runId, runId));

  const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId)).limit(1);
  const run = runs[0];

  await db
    .update(schema.agentRuns)
    .set({
      status,
      resultSummary: summary,
      ...(status === 'failed' ? { error: summary.slice(0, 2000) } : {}),
      inputTokens: usage[0]?.input ?? 0,
      outputTokens: usage[0]?.output ?? 0,
      costUsd: usage[0]?.cost ?? '0',
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.agentRuns.id, runId));

  if (run?.goalId) {
    await db
      .update(schema.goals)
      .set({ status: status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'in_progress' })
      .where(eq(schema.goals.id, run.goalId));
  }

  await emitAndNotify({
    runId,
    projectId: run?.projectId ?? '',
    type: status === 'completed' ? 'run.completed' : status === 'cancelled' ? 'run.cancelled' : 'run.failed',
    level: status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'warning',
    summary: status === 'completed' ? 'Run completed' : status === 'cancelled' ? 'Run cancelled' : 'Run failed',
    payload: { summary: summary.slice(0, 1000) },
  });

  // Persist the outcome as durable project memory (§9 execution memory).
  if (run) {
    await db.insert(schema.memories).values({
      projectId: run.projectId,
      kind: 'execution',
      title: `${status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : 'Cancelled'}: ${run.title}`,
      content: summary,
      source: 'run-engine',
      runId,
      tags: ['run-outcome', status],
    });

    // Notify the requesting user. Guarded: only if a real, existing user is the
    // requester — never the project id, which would violate the FK and 500.
    if (run.requestedByUserId && run.requestedByUserId !== run.projectId) {
      const requester = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, run.requestedByUserId))
        .limit(1);
      if (requester[0]) {
        await db.insert(schema.notifications).values({
          userId: run.requestedByUserId,
          projectId: run.projectId,
          kind: status === 'completed' ? 'run_completed' : status === 'failed' ? 'run_failed' : 'run_completed',
          title: `Run ${status}: ${run.title}`,
          body: summary.slice(0, 500),
          link: `/projects/${run.projectId}/runs/${runId}`,
        });
      }
    }
  }

  // Mission Mode: after a run finalises, let the supervisor decide whether the
  // parent objective is done or needs another run. Dynamic import avoids a
  // circular dependency (mission.ts imports createRun from this file).
  if (run?.objectiveId) {
    const objectiveId = run.objectiveId;
    void import('./mission')
      .then(({ superviseObjective }) => superviseObjective(objectiveId))
      .catch((error) => {
        log.warn('mission supervision failed', {
          objectiveId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  await stopProjectDevServers(run?.projectId ?? '').catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Recovery (§18)
// ---------------------------------------------------------------------------

/**
 * Runs left in a live state by a crashed or restarted process are re-queued with
 * a recovery marker, so the orchestrator continues instead of restarting.
 */
export async function recoverStalledRuns(): Promise<number> {
  const db = await getDb();
  const stalled = await db
    .select()
    .from(schema.agentRuns)
    .where(
      or(
        eq(schema.agentRuns.status, 'running'),
        eq(schema.agentRuns.status, 'queued'),
        eq(schema.agentRuns.status, 'waiting_for_user'),
      ),
    );

  let recovered = 0;
  for (const run of stalled) {
    const checkpoints = await db
      .select()
      .from(schema.runCheckpoints)
      .where(eq(schema.runCheckpoints.runId, run.id))
      .orderBy(desc(schema.runCheckpoints.createdAt))
      .limit(1);

    await db
      .update(schema.agentRuns)
      .set({ status: 'queued', controlSignal: null, updatedAt: new Date() })
      .where(eq(schema.agentRuns.id, run.id));

    await emitAndNotify({
      runId: run.id,
      projectId: run.projectId,
      type: 'run.recovered',
      level: 'warning',
      summary: `Recovering interrupted run from checkpoint "${checkpoints[0]?.label ?? 'start'}" — continuing rather than restarting`,
      payload: {
        checkpoint: checkpoints[0]?.label ?? null,
        phase: checkpoints[0]?.phase ?? run.phase,
      },
    }).catch(() => undefined);

    recovered += 1;
  }

  if (recovered > 0) log.info(`recovered ${recovered} stalled run(s)`);
  return recovered;
}

/** Runs that are live right now — used by the home command center. */
export async function activeRunSummaries() {
  const db = await getDb();
  return db
    .select()
    .from(schema.agentRuns)
    .where(
      inArray(schema.agentRuns.status, ['running', 'queued', 'paused', 'waiting_for_approval', 'waiting_for_user']),
    )
    .orderBy(desc(schema.agentRuns.updatedAt));
}

/** Runs still marked live in this process (dev servers excluded). */
export function inProcessRunCount(): number {
  return activeRuns.size;
}

export async function pendingRunCount(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.agentRuns)
    .where(isNull(schema.agentRuns.finishedAt));
  return rows[0]?.count ?? 0;
}
