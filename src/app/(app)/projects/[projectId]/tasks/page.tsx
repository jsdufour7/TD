import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { notFound } from 'next/navigation';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { toneFor, timeAgo } from '@/lib/ui';
import { TaskBoard } from '@/components/work/task-board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tasks' };

const COLUMNS: Array<{ status: string; label: string; tone: string }> = [
  { status: 'backlog', label: 'Backlog', tone: 'idle' },
  { status: 'ready', label: 'Ready', tone: 'info' },
  { status: 'running', label: 'Running', tone: 'accent' },
  { status: 'blocked', label: 'Blocked', tone: 'warn' },
  { status: 'completed', label: 'Completed', tone: 'ok' },
  { status: 'failed', label: 'Failed', tone: 'danger' },
];

/** Task board plus execution graph (§16, §30). */
export default async function TasksPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  try {
    await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.projectId, projectId))
    .orderBy(asc(schema.tasks.priority), asc(schema.tasks.createdAt));

  const ids = new Set(tasks.map((t) => t.id));
  const dependencies = (await db.select().from(schema.taskDependencies)).filter((d) => ids.has(d.taskId));

  if (tasks.length === 0) {
    return (
      <div className="p-5">
        <Card title="Tasks">
          <div className="p-5">
            <EmptyState
              title="No tasks yet"
              description="Tasks are created when the COO plans a run. Start an objective on the Work surface and the task graph appears here."
            />
          </div>
        </Card>
      </div>
    );
  }

  const serialised = tasks.map((task) => ({
    id: task.id,
    runId: task.runId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignedAgentKey: task.assignedAgentDefinitionKey,
    acceptanceCriteria: task.acceptanceCriteria as string[],
    attemptCount: task.attemptCount,
    maxAttempts: task.maxAttempts,
    blockedReason: task.blockedReason,
    outputSummary: task.outputSummary,
    createdAt: task.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-4 p-5">
      <TaskBoard projectId={projectId} initialTasks={serialised} columns={COLUMNS} />

      <Card
        title="Execution graph"
        description="Dependencies determine what may run. A task waits until everything it depends on has finished or is itself blocked."
      >
        <div className="space-y-2 p-4">
          {serialised.map((task) => {
            const deps = dependencies.filter((d) => d.taskId === task.id);
            return (
              <div key={task.id} className="flex flex-wrap items-center gap-2 text-[11.5px]">
                <Badge tone={toneFor(task.status)}>{task.status.replace(/_/g, ' ')}</Badge>
                <span className="min-w-0 flex-1 truncate text-ink-1">{task.title}</span>
                {deps.length > 0 ? (
                  <span className="flex items-center gap-1 font-mono text-[10px] text-ink-4">
                    ← depends on{' '}
                    {deps.map((d) => serialised.find((t) => t.id === d.dependsOnTaskId)?.title ?? 'unknown').join(', ')}
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-ink-4">no dependencies</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Recently finished" description="Outcome summaries recorded by the executing agent">
        <ul className="divide-y divide-line">
          {serialised
            .filter((t) => ['completed', 'failed', 'blocked'].includes(t.status))
            .slice(-12)
            .reverse()
            .map((task) => (
              <li key={task.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Badge tone={toneFor(task.status)}>{task.status}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-1">{task.title}</span>
                  <span className="text-[10.5px] text-ink-4">{timeAgo(task.createdAt)}</span>
                </div>
                {task.outputSummary ? (
                  <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-ink-3">{task.outputSummary}</p>
                ) : null}
                {task.blockedReason ? (
                  <p className="mt-1 text-[11px] text-warn">{task.blockedReason}</p>
                ) : null}
              </li>
            ))}
        </ul>
      </Card>
    </div>
  );
}
