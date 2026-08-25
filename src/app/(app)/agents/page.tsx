import Link from 'next/link';
import { desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { toneFor, timeAgo, durationLabel } from '@/lib/ui';
import { PageHeader } from '@/components/layout/page-header';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Agents' };

/**
 * Agent observability (§28).
 *
 * The catalog shows what each agent is allowed to do — tools, permissions, model
 * policy, step budget — and the instance list shows real live state read from the
 * database. An agent listed as "working" is genuinely mid-execution.
 */
export default async function AgentsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const db = await getDb();
  const definitions = await db.select().from(schema.agentDefinitions).orderBy(schema.agentDefinitions.sortOrder);

  const projects = await db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, user.organizationId));
  const projectIds = projects.map((p) => p.id);
  const projectById = new Map(projects.map((p) => [p.id, p.name]));

  const instances =
    projectIds.length > 0
      ? await db
          .select()
          .from(schema.agentInstances)
          .where(inArray(schema.agentInstances.projectId, projectIds))
          .orderBy(desc(schema.agentInstances.startedAt))
          .limit(150)
      : [];

  const tasks =
    projectIds.length > 0
      ? await db.select({ id: schema.tasks.id, title: schema.tasks.title }).from(schema.tasks).where(inArray(schema.tasks.projectId, projectIds))
      : [];
  const taskById = new Map(tasks.map((t) => [t.id, t.title]));

  const active = instances.filter((i) => !['completed', 'failed'].includes(i.status));

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5 lg:p-7">
      <PageHeader
        title="Agents"
        subtitle="Specialist roles with distinct tools, permissions and model policies. The COO instantiates the smallest competent team for each objective — not every agent for every task."
      />

      {active.length > 0 ? (
        <Card title="Active now" description={`${active.length} instance(s) with live state`}>
          <ul className="divide-y divide-line">
            {active.map((instance) => {
              const definition = definitions.find((d) => d.key === instance.definitionKey);
              return (
                <li key={instance.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <Badge tone={toneFor(instance.status)} dot={instance.status === 'working' || instance.status === 'using_tool'}>
                    {instance.status.replace(/_/g, ' ')}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink-1">{definition?.name ?? instance.definitionKey}</p>
                    <p className="truncate text-[11px] text-ink-4">
                      {instance.lastAction ?? '—'} · {projectById.get(instance.projectId) ?? 'unknown'}
                      {instance.taskId ? ` · ${taskById.get(instance.taskId) ?? ''}` : ''}
                    </p>
                  </div>
                  <span className="font-mono text-[10.5px] text-ink-4">
                    {instance.toolCalls} tools · {instance.stepsUsed} steps
                  </span>
                  {instance.providerKey ? (
                    <span className="font-mono text-[10.5px] text-ink-4">{instance.providerKey}</span>
                  ) : null}
                  <span className="text-[10.5px] text-ink-4">{timeAgo(instance.startedAt.toISOString())}</span>
                  {instance.runId ? (
                    <Link
                      href={`/projects/${instance.projectId}/runs/${instance.runId}`}
                      className="text-[11px] text-accent hover:underline"
                    >
                      run
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {definitions.map((definition) => {
          const definitionInstances = instances.filter((i) => i.definitionKey === definition.key);
          return (
            <Card key={definition.key} title={definition.name} description={definition.role}>
              <div className="space-y-3 p-4">
                <p className="text-[12px] leading-relaxed text-ink-3">{definition.description}</p>

                <div>
                  <p className="text-[10.5px] tracking-wide text-ink-4 uppercase">Allowed tools</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(definition.allowedTools as string[]).map((tool) => (
                      <span key={tool} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {(definition.permissions as string[]).map((permission) => (
                    <Badge key={permission} tone={permission === 'destructive' ? 'danger' : permission === 'execute' ? 'warn' : 'idle'}>
                      {permission}
                    </Badge>
                  ))}
                </div>

                <dl className="grid grid-cols-3 gap-2 border-t border-line pt-2.5 text-center">
                  <div>
                    <dt className="text-[9.5px] tracking-wide text-ink-4 uppercase">Policy</dt>
                    <dd className="font-mono text-[11px] text-ink-2">{definition.modelPolicy}</dd>
                  </div>
                  <div>
                    <dt className="text-[9.5px] tracking-wide text-ink-4 uppercase">Max steps</dt>
                    <dd className="font-mono text-[11px] text-ink-2">{definition.maxSteps}</dd>
                  </div>
                  <div>
                    <dt className="text-[9.5px] tracking-wide text-ink-4 uppercase">Invocations</dt>
                    <dd className="font-mono text-[11px] text-ink-2">{definitionInstances.length}</dd>
                  </div>
                </dl>

                {definitionInstances.length > 0 ? (
                  <div className="border-t border-line pt-2.5">
                    <p className="text-[10.5px] tracking-wide text-ink-4 uppercase">Recent</p>
                    <ul className="mt-1 space-y-1">
                      {definitionInstances.slice(0, 3).map((instance) => (
                        <li key={instance.id} className="flex items-center gap-1.5 text-[10.5px]">
                          <Badge tone={toneFor(instance.status)}>{instance.status.replace(/_/g, ' ')}</Badge>
                          <span className="min-w-0 flex-1 truncate text-ink-3">
                            {instance.summary ?? instance.lastAction ?? taskById.get(instance.taskId ?? '') ?? '—'}
                          </span>
                          {instance.startedAt && instance.finishedAt ? (
                            <span className="font-mono text-ink-4">
                              {durationLabel(new Date(instance.finishedAt).getTime() - new Date(instance.startedAt).getTime())}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      {instances.length === 0 ? (
        <Card>
          <div className="p-5">
            <EmptyState
              title="No agent activity yet"
              description="Agents are instantiated on demand when a run starts. Their live state, tool usage and outcomes appear here."
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
