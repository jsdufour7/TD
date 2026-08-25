import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { serialiseRun } from '../route';
import { serialiseRunEvent } from '@/engine/events';

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; runId: string }> },
): Promise<Response> {
  try {
    const { projectId, runId } = await context.params;
    await requireProject(projectId);
    const db = await getDb();

    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(and(eq(schema.agentRuns.id, runId), eq(schema.agentRuns.projectId, projectId)))
      .limit(1);
    const run = runs[0];
    // A run that does not exist — or that belongs to a different project — is
    // indistinguishable from the caller's point of view: 404, never 500.
    if (!run) return jsonError(notFound('Run not found'));

    const [events, tasks, changes, instances, commands, tests, approvals] = await Promise.all([
      db
        .select()
        .from(schema.runEvents)
        .where(eq(schema.runEvents.runId, runId))
        .orderBy(desc(schema.runEvents.seq))
        .limit(500),
      db.select().from(schema.tasks).where(eq(schema.tasks.runId, runId)),
      db.select().from(schema.gitChanges).where(eq(schema.gitChanges.runId, runId)),
      db.select().from(schema.agentInstances).where(eq(schema.agentInstances.runId, runId)),
      db
        .select()
        .from(schema.commands)
        .where(eq(schema.commands.runId, runId))
        .orderBy(desc(schema.commands.startedAt))
        .limit(50),
      db.select().from(schema.testRuns).where(eq(schema.testRuns.runId, runId)),
      db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.runId, runId)),
    ]);

    return jsonOk({
      run: serialiseRun(run),
      events: events.reverse().map(serialiseRunEvent),
      tasks: tasks.map(serialiseTask),
      changes: changes.map((c) => ({
        id: c.id,
        path: c.path,
        changeType: c.changeType,
        additions: c.additions,
        deletions: c.deletions,
      })),
      agents: instances.map((i) => ({
        id: i.id,
        definitionKey: i.definitionKey,
        status: i.status,
        lastAction: i.lastAction,
        summary: i.summary,
        stepsUsed: i.stepsUsed,
        toolCalls: i.toolCalls,
        modelId: i.modelId,
        providerKey: i.providerKey,
        startedAt: i.startedAt?.toISOString() ?? null,
        finishedAt: i.finishedAt?.toISOString() ?? null,
      })),
      commands: commands.map((c) => ({
        id: c.id,
        label: c.label,
        status: c.status,
        exitCode: c.exitCode,
        durationMs: c.durationMs,
        previewUrl: c.previewUrl,
        startedAt: c.startedAt.toISOString(),
      })),
      tests: tests.map((t) => ({
        id: t.id,
        suite: t.suite,
        status: t.status,
        total: t.total,
        passed: t.passed,
        failed: t.failed,
        durationMs: t.durationMs,
      })),
      approvals: approvals.map((a) => ({
        id: a.id,
        category: a.category,
        title: a.title,
        status: a.status,
        risk: a.risk,
        requestedAt: a.requestedAt.toISOString(),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export function serialiseTask(task: typeof schema.tasks.$inferSelect) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    acceptanceCriteria: task.acceptanceCriteria,
    status: task.status,
    priority: task.priority,
    assignedAgentKey: task.assignedAgentDefinitionKey,
    agentInstanceId: task.agentInstanceId,
    origin: task.origin,
    attemptCount: task.attemptCount,
    maxAttempts: task.maxAttempts,
    blockedReason: task.blockedReason,
    outputSummary: task.outputSummary,
    startedAt: task.startedAt?.toISOString() ?? null,
    finishedAt: task.finishedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
  };
}
