import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { notFound } from 'next/navigation';
import { Workbench } from '@/components/work/workbench';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Work' };

export default async function WorkPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  let project;
  try {
    project = await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const [runs, repository, providers] = await Promise.all([
    db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.projectId, projectId))
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(20),
    db.select().from(schema.repositories).where(eq(schema.repositories.projectId, projectId)).limit(1),
    db.select().from(schema.modelProviders),
  ]);

  const anyProviderUsable = providers.some(
    (p) => p.isEnabled && p.healthStatus !== 'offline',
  );

  // Server-render the detail of the initially selected run so the panels are
  // populated on first paint, instead of the client fetching it in an effect.
  const selectedRunId = runs[0]?.id ?? null;
  const initialDetail = selectedRunId
    ? await loadRunDetail(projectId, selectedRunId)
    : null;

  return (
    <Workbench
      projectId={project.id}
      hasRepository={Boolean(repository[0])}
      hasModelProvider={anyProviderUsable}
      initialDetail={initialDetail}
      initialRuns={runs.map((run) => ({
        id: run.id,
        title: run.title,
        objective: run.objective,
        status: run.status,
        phase: run.phase,
        controlSignal: run.controlSignal,
        resultSummary: run.resultSummary,
        error: run.error,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      }))}
    />
  );
}

async function loadRunDetail(projectId: string, runId: string) {
  const db = await getDb();
  const [tasks, changes, events, agents, commands, tests] = await Promise.all([
    db.select().from(schema.tasks).where(eq(schema.tasks.runId, runId)),
    db.select().from(schema.gitChanges).where(eq(schema.gitChanges.runId, runId)),
    db
      .select()
      .from(schema.runEvents)
      .where(and(eq(schema.runEvents.runId, runId), eq(schema.runEvents.projectId, projectId)))
      .orderBy(asc(schema.runEvents.seq))
      .limit(500),
    db.select().from(schema.agentInstances).where(eq(schema.agentInstances.runId, runId)),
    db
      .select()
      .from(schema.commands)
      .where(eq(schema.commands.runId, runId))
      .orderBy(desc(schema.commands.startedAt))
      .limit(50),
    db.select().from(schema.testRuns).where(eq(schema.testRuns.runId, runId)),
  ]);

  return {
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      assignedAgentKey: task.assignedAgentDefinitionKey,
      acceptanceCriteria: task.acceptanceCriteria as string[],
      attemptCount: task.attemptCount,
      maxAttempts: task.maxAttempts,
      blockedReason: task.blockedReason,
      outputSummary: task.outputSummary,
    })),
    changes: changes.map((change) => ({
      id: change.id,
      path: change.path,
      changeType: change.changeType,
      additions: change.additions,
      deletions: change.deletions,
    })),
    events: events.map((event) => ({
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
    })),
    agents: agents.map((agent) => ({
      id: agent.id,
      definitionKey: agent.definitionKey,
      status: agent.status,
      lastAction: agent.lastAction,
    })),
    commands: commands.map((command) => ({
      id: command.id,
      label: command.label,
      status: command.status,
      exitCode: command.exitCode,
      previewUrl: command.previewUrl,
    })),
    tests: tests.map((test) => ({
      id: test.id,
      suite: test.suite,
      status: test.status,
      passed: test.passed,
      failed: test.failed,
    })),
  };
}
