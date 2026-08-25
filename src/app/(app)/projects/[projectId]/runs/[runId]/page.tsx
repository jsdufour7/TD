import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { Badge, Card, EmptyState, Stat } from '@/components/ui/primitives';
import { toneFor, timeAgo, durationLabel, formatTokens, formatCost } from '@/lib/ui';
import { RunDetailActions } from '@/components/work/run-detail-actions';
import { createTwoFilesPatch } from 'diff';

export const dynamic = 'force-dynamic';

/**
 * Run detail (§17, §18, §31).
 *
 * The complete durable record of one autonomous run: its plan, its tasks, the
 * agents that executed them, every tool call, file diffs, verification results
 * and checkpoints. Everything here survives a refresh because it is in the
 * database, not in browser state.
 */
export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; runId: string }>;
}) {
  const { projectId, runId } = await params;
  try {
    await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const runs = await db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.id, runId), eq(schema.agentRuns.projectId, projectId)))
    .limit(1);
  const run = runs[0];
  if (!run) notFound();

  const [events, tasks, changes, instances, commands, tests, approvals, checkpoints, usage, toolCalls] =
    await Promise.all([
      db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, runId)).orderBy(desc(schema.runEvents.seq)).limit(1000),
      db.select().from(schema.tasks).where(eq(schema.tasks.runId, runId)),
      db.select().from(schema.gitChanges).where(eq(schema.gitChanges.runId, runId)),
      db.select().from(schema.agentInstances).where(eq(schema.agentInstances.runId, runId)),
      db.select().from(schema.commands).where(eq(schema.commands.runId, runId)).orderBy(desc(schema.commands.startedAt)),
      db.select().from(schema.testRuns).where(eq(schema.testRuns.runId, runId)),
      db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.runId, runId)),
      db.select().from(schema.runCheckpoints).where(eq(schema.runCheckpoints.runId, runId)).orderBy(desc(schema.runCheckpoints.createdAt)),
      db
        .select({
          input: schema.modelUsages.inputTokens,
          output: schema.modelUsages.outputTokens,
          cost: schema.modelUsages.costUsd,
          model: schema.modelUsages.modelKey,
          provider: schema.modelUsages.providerKey,
          duration: schema.modelUsages.durationMs,
          outcome: schema.modelUsages.outcome,
        })
        .from(schema.modelUsages)
        .where(eq(schema.modelUsages.runId, runId)),
      db.select().from(schema.toolCalls).where(eq(schema.toolCalls.runId, runId)).orderBy(desc(schema.toolCalls.startedAt)).limit(200),
    ]);

  const definitions = await db.select().from(schema.agentDefinitions);
  const definitionByKey = new Map(definitions.map((d) => [d.key, d]));

  const totalInput = usage.reduce((s, u) => s + u.input, 0);
  const totalOutput = usage.reduce((s, u) => s + u.output, 0);
  const totalCost = usage.reduce((s, u) => s + (Number.parseFloat(u.cost) || 0), 0);
  const isLive = ['running', 'queued', 'paused', 'waiting_for_approval', 'waiting_for_user'].includes(run.status);

  const taskStatusCounts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/projects/${projectId}/work`} className="text-[11px] text-ink-4 hover:text-accent">
            ← back to work surface
          </Link>
          <h1 className="mt-1 text-lg font-semibold tracking-tight text-ink-1">{run.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={toneFor(run.status)} dot={isLive}>
              {run.status.replace(/_/g, ' ')}
            </Badge>
            <span className="font-mono text-[11px] text-ink-4">phase {run.phase}</span>
            <span className="font-mono text-[11px] text-ink-4">policy {run.routingPolicy}</span>
            <span className="text-[11px] text-ink-4">created {timeAgo(run.createdAt.toISOString())}</span>
            {run.finishedAt ? (
              <span className="text-[11px] text-ink-4">
                ran for {durationLabel(new Date(run.finishedAt).getTime() - (run.startedAt?.getTime() ?? new Date(run.createdAt).getTime()))}
              </span>
            ) : null}
          </div>
        </div>
        <RunDetailActions projectId={projectId} runId={runId} status={run.status} isLive={isLive} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Tasks" value={tasks.length} />
        <Stat label="Completed" value={taskStatusCounts.completed ?? 0} tone="ok" />
        <Stat label="Failed" value={taskStatusCounts.failed ?? 0} tone={taskStatusCounts.failed ? 'danger' : 'idle'} />
        <Stat label="Blocked" value={taskStatusCounts.blocked ?? 0} tone={taskStatusCounts.blocked ? 'warn' : 'idle'} />
        <Stat label="Files changed" value={changes.length} />
        <Stat label="Tokens" value={formatTokens(totalInput + totalOutput)} hint={formatCost(totalCost)} />
      </div>

      <Card title="Objective">
        <pre className="whitespace-pre-wrap p-4 font-mono text-[12px] text-ink-2">{run.objective}</pre>
      </Card>

      {run.resultSummary ? (
        <Card title="Outcome" description="Assembled from recorded task results, file changes and verification runs">
          <pre className="whitespace-pre-wrap p-4 font-mono text-[12px] text-ink-1">{run.resultSummary}</pre>
        </Card>
      ) : null}

      {run.error ? (
        <Card title="Failure">
          <pre className="whitespace-pre-wrap p-4 font-mono text-[12px] text-danger">{run.error}</pre>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Task plan" description={`${tasks.length} tasks created by the planner`}>
          {tasks.length === 0 ? (
            <div className="p-4">
              <EmptyState compact title="No tasks" description="The run has not reached planning yet." />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {tasks.map((task) => (
                <li key={task.id} className="px-4 py-2.5">
                  <div className="flex items-start gap-2">
                    <Badge tone={toneFor(task.status)}>{task.status.replace(/_/g, ' ')}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-ink-1">{task.title}</p>
                      <p className="font-mono text-[10px] text-ink-4">
                        {task.assignedAgentDefinitionKey ?? 'unassigned'} · attempt {task.attemptCount}/{task.maxAttempts}
                        {task.startedAt && task.finishedAt
                          ? ` · ${durationLabel(new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime())}`
                          : ''}
                      </p>
                      {task.outputSummary ? (
                        <p className="mt-1 whitespace-pre-wrap font-mono text-[10.5px] text-ink-3">{task.outputSummary}</p>
                      ) : null}
                      {task.blockedReason ? (
                        <p className="mt-1 text-[10.5px] text-warn">{task.blockedReason}</p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Agents" description="Instances created for this run">
          {instances.length === 0 ? (
            <div className="p-4">
              <EmptyState compact title="No agents instantiated" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {instances.map((instance) => (
                <li key={instance.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={toneFor(instance.status)} dot={instance.status === 'working'}>
                      {instance.status.replace(/_/g, ' ')}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-1">
                      {definitionByKey.get(instance.definitionKey)?.name ?? instance.definitionKey}
                    </span>
                    <span className="font-mono text-[10px] text-ink-4">
                      {instance.toolCalls} tools · {instance.stepsUsed} steps
                    </span>
                  </div>
                  {instance.summary ? (
                    <p className="mt-1 text-[11px] text-ink-3">{instance.summary}</p>
                  ) : null}
                  {instance.error ? <p className="mt-1 text-[11px] text-danger">{instance.error}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Diff review" description="Every file this run changed, with a real unified diff">
        {changes.length === 0 ? (
          <div className="p-4">
            <EmptyState compact title="No file changes in this run" />
          </div>
        ) : (
          <div className="divide-y divide-line">
            {changes.map((change) => (
              <details key={change.id} className="group">
                <summary className="flex cursor-pointer items-center gap-2 px-4 py-2 hover:bg-surface-2">
                  <Badge tone={change.changeType === 'deleted' ? 'danger' : change.changeType === 'added' ? 'ok' : 'info'}>
                    {change.changeType}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-1">{change.path}</span>
                  <span className="font-mono text-[10.5px]">
                    <span className="text-ok">+{change.additions}</span>{' '}
                    <span className="text-danger">−{change.deletions}</span>
                  </span>
                </summary>
                <pre className="overflow-x-auto border-t border-line bg-surface-0 p-3 font-mono text-[11px] leading-relaxed">
                  {createTwoFilesPatch(
                    `a/${change.path}`,
                    `b/${change.path}`,
                    change.beforeContent ?? '',
                    change.afterContent ?? '',
                    '',
                    '',
                    { context: 3 },
                  )
                    .split('\n')
                    .map((line, index) => (
                      <span
                        key={index}
                        className={
                          line.startsWith('+') && !line.startsWith('+++')
                            ? 'block bg-ok/10 text-ok'
                            : line.startsWith('-') && !line.startsWith('---')
                              ? 'block bg-danger/10 text-danger'
                              : line.startsWith('@@')
                                ? 'block text-info'
                                : 'block text-ink-3'
                        }
                      >
                        {line || ' '}
                      </span>
                    ))}
                </pre>
              </details>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Verification" description="Real runner output, never asserted by the agent">
          {tests.length === 0 ? (
            <div className="p-4">
              <EmptyState compact title="No test runs recorded" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {tests.map((test) => (
                <li key={test.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={toneFor(test.status === 'passed' ? 'completed' : 'failed')}>{test.status}</Badge>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-1">{test.suite}</span>
                    <span className="font-mono text-[10.5px] text-ink-3">
                      {test.passed}/{test.total} · {durationLabel(test.durationMs)}
                    </span>
                  </div>
                  {test.failed > 0 && test.output ? (
                    <pre className="mt-1.5 max-h-40 overflow-auto rounded border border-danger/25 bg-danger/8 p-2 font-mono text-[10px] text-danger">
                      {test.output.slice(-3000)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Commands" description="Everything executed, with exit codes">
          {commands.length === 0 ? (
            <div className="p-4">
              <EmptyState compact title="No commands executed" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {commands.slice(0, 20).map((command) => (
                <li key={command.id} className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        command.status === 'succeeded'
                          ? 'ok'
                          : command.status === 'running'
                            ? 'accent'
                            : command.status === 'cancelled'
                              ? 'idle'
                              : 'danger'
                      }
                    >
                      {command.status}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">{command.label}</span>
                    <span className="font-mono text-[10px] text-ink-4">exit {command.exitCode ?? '—'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Checkpoints" description="Recovery points written during execution — these are what make an interrupted run resumable">
        {checkpoints.length === 0 ? (
          <div className="p-4">
            <EmptyState compact title="No checkpoints yet" />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {checkpoints.map((checkpoint) => (
              <li key={checkpoint.id} className="flex items-center gap-3 px-4 py-2">
                <span className="font-mono text-[10.5px] text-accent">{checkpoint.label}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-3">phase {checkpoint.phase}</span>
                <span className="text-[10.5px] text-ink-4">{timeAgo(checkpoint.createdAt.toISOString())}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Model usage" description={`${usage.length} calls`}>
        {usage.length === 0 ? (
          <div className="p-4">
            <EmptyState
              compact
              title="No model calls recorded"
              description="Either no provider is configured, or the run completed deterministically."
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {usage.slice(0, 30).map((call, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2 px-4 py-1.5 font-mono text-[10.5px]">
                <Badge tone={call.outcome === 'ok' ? 'ok' : 'danger'}>{call.outcome}</Badge>
                <span className="text-ink-2">
                  {call.provider}/{call.model}
                </span>
                <span className="text-ink-4">
                  {formatTokens(call.input)} in · {formatTokens(call.output)} out
                </span>
                <span className="text-ink-4">{durationLabel(call.duration)}</span>
                <span className="ml-auto text-ink-3">{formatCost(call.cost)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Event log" description={`${events.length} events, newest first`}>
        <ul className="max-h-[36rem] divide-y divide-line overflow-y-auto">
          {events.map((event) => (
            <li key={event.id} className="flex gap-2.5 px-4 py-1.5">
              <span className="mt-1.5 font-mono text-[9.5px] text-ink-4">#{event.seq}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-ink-1">{event.summary}</p>
                <p className="font-mono text-[10px] text-ink-4">
                  {event.type} · {event.actor} · {new Date(event.createdAt).toLocaleTimeString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {toolCalls.length > 0 ? (
        <Card title="Tool calls" description={`${toolCalls.length} recorded invocations`}>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {toolCalls.map((call) => (
              <li key={call.id} className="flex items-center gap-2 px-4 py-1.5 font-mono text-[10.5px]">
                <Badge tone={call.status === 'succeeded' ? 'ok' : call.status === 'pending' ? 'idle' : 'danger'}>
                  {call.status}
                </Badge>
                <span className="text-ink-2">{call.toolName}</span>
                <span className="text-ink-4">{call.permissionCategory}</span>
                <span className="ml-auto text-ink-4">{durationLabel(call.durationMs)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {approvals.length > 0 ? (
        <Card title="Approval requests">
          <ul className="divide-y divide-line">
            {approvals.map((approval) => (
              <li key={approval.id} className="flex items-center gap-2 px-4 py-2">
                <Badge tone={toneFor(approval.status === 'approved' ? 'completed' : approval.status === 'pending' ? 'paused' : 'failed')}>
                  {approval.status}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-1">{approval.title}</span>
                <span className="font-mono text-[10px] text-ink-4">{approval.category}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
