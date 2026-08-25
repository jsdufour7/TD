import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { Badge, Card, EmptyState, Stat, toneTextClass } from '@/components/ui/primitives';
import { toneFor, timeAgo } from '@/lib/ui';
import { PageHeader } from '@/components/layout/page-header';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home' };

/**
 * Command center (§27).
 *
 * Answers six questions, each with a real query: what projects exist, what is
 * running, who is working, what needs my attention, what failed recently, and
 * what was delivered. No decorative charts.
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const db = await getDb();
  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, user.organizationId))
    .orderBy(desc(schema.projects.updatedAt));
  const projectIds = projects.map((p) => p.id);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const hasProjects = projectIds.length > 0;
  const scope = <T,>(fallback: T[], query: () => Promise<T[]>) => (hasProjects ? query() : Promise.resolve(fallback));

  const [runs, approvals, instances, events, artifacts, providers, definitions] = await Promise.all([
    scope([], () =>
      db
        .select()
        .from(schema.agentRuns)
        .where(inArray(schema.agentRuns.projectId, projectIds))
        .orderBy(desc(schema.agentRuns.createdAt))
        .limit(300),
    ),
    scope([], () =>
      db
        .select()
        .from(schema.approvalRequests)
        .where(and(inArray(schema.approvalRequests.projectId, projectIds), eq(schema.approvalRequests.status, 'pending')))
        .orderBy(desc(schema.approvalRequests.requestedAt)),
    ),
    scope([], () =>
      db
        .select()
        .from(schema.agentInstances)
        .where(
          and(
            inArray(schema.agentInstances.projectId, projectIds),
            inArray(schema.agentInstances.status, ['working', 'planning', 'using_tool', 'testing', 'reviewing', 'waiting', 'blocked']),
          ),
        )
        .orderBy(desc(schema.agentInstances.startedAt))
        .limit(20),
    ),
    scope([], () =>
      db
        .select()
        .from(schema.runEvents)
        .where(inArray(schema.runEvents.projectId, projectIds))
        .orderBy(desc(schema.runEvents.createdAt))
        .limit(40),
    ),
    scope([], () =>
      db
        .select()
        .from(schema.artifacts)
        .where(inArray(schema.artifacts.projectId, projectIds))
        .orderBy(desc(schema.artifacts.createdAt))
        .limit(8),
    ),
    db.select().from(schema.modelProviders),
    db.select().from(schema.agentDefinitions),
  ]);

  const definitionByKey = new Map(definitions.map((d) => [d.key, d]));
  const activeRuns = runs.filter((r) =>
    ['running', 'queued', 'paused', 'waiting_for_approval', 'waiting_for_user'].includes(r.status),
  );
  const failures = runs.filter((r) => r.status === 'failed').slice(0, 5);
  const completed = runs.filter((r) => r.status === 'completed').slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5 lg:p-7">
      <PageHeader
        title="Command Center"
        subtitle="Live state across every project. Every figure below is a real query result."
        action={
          <Link
            href="/projects"
            className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-accent-ink hover:bg-accent/90"
          >
            {projects.length === 0 ? 'Create your first project' : 'All projects'}
          </Link>
        }
      />

      {projects.length === 0 ? (
        <Card>
          <div className="p-6">
            <EmptyState
              title="No projects yet"
              description="A project is a persistent intelligence workspace: instructions, files, memory, conversations, runs and tasks. Create one to give AI Core something to work on."
              action={
                <Link
                  href="/projects"
                  className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-accent-ink"
                >
                  Create a project
                </Link>
              }
            />
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Projects" value={projects.length} />
        <Stat label="Active runs" value={activeRuns.length} tone={activeRuns.length > 0 ? 'accent' : 'idle'} />
        <Stat label="Agents working" value={instances.length} tone={instances.length > 0 ? 'accent' : 'idle'} />
        <Stat
          label="Needs approval"
          value={approvals.length}
          tone={approvals.length > 0 ? 'warn' : 'idle'}
        />
        <Stat label="Failures" value={failures.length} tone={failures.length > 0 ? 'danger' : 'idle'} />
        <Stat label="Completed" value={runs.filter((r) => r.status === 'completed').length} tone="ok" />
      </div>

      {approvals.length > 0 ? (
        <Card title="Requires your attention" description="Operations are blocked until you decide">
          <ul className="divide-y divide-line">
            {approvals.map((approval) => (
              <li key={approval.id}>
                <Link
                  href={`/approvals?highlight=${approval.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <Badge tone={approval.risk === 'critical' ? 'danger' : approval.risk === 'high' ? 'warn' : 'info'}>
                    {approval.risk}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink-1">{approval.title}</p>
                    <p className="truncate text-[11px] text-ink-4">
                      {projectById.get(approval.projectId)?.name ?? 'Unknown'} · {approval.category} ·{' '}
                      {timeAgo(approval.requestedAt.toISOString())}
                    </p>
                  </div>
                  <span className="text-[11px] text-accent">Review</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Currently running" description="Runs in flight right now">
          {activeRuns.length === 0 ? (
            <div className="p-4">
              <EmptyState
                compact
                title="Nothing is running"
                description="Open a project and give AI Core an objective to start a run."
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {activeRuns.slice(0, 8).map((run) => (
                <li key={run.id}>
                  <Link
                    href={`/projects/${run.projectId}/runs/${run.id}`}
                    className="block px-4 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone={toneFor(run.status)} dot>
                        {run.status.replace(/_/g, ' ')}
                      </Badge>
                      <span className="truncate text-[13px] text-ink-1">{run.title}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-ink-4">
                      {projectById.get(run.projectId)?.name} · phase {run.phase} ·{' '}
                      {timeAgo(run.updatedAt.toISOString())}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Agents working" description="Instances with live state">
          {instances.length === 0 ? (
            <div className="p-4">
              <EmptyState compact title="No agents active" description="Agents are instantiated on demand by the COO." />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {instances.map((instance) => (
                <li key={instance.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-3 font-mono text-[10px] text-ink-2">
                    {(definitionByKey.get(instance.definitionKey)?.name ?? instance.definitionKey)
                      .split(' ')
                      .map((w) => w[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink-1">
                      {definitionByKey.get(instance.definitionKey)?.name ?? instance.definitionKey}
                    </p>
                    <p className="truncate text-[11px] text-ink-4">
                      {instance.lastAction ?? instance.status} · {projectById.get(instance.projectId)?.name}
                    </p>
                  </div>
                  <Badge tone={toneFor(instance.status)} dot={instance.status === 'working' || instance.status === 'using_tool'}>
                    {instance.status.replace(/_/g, ' ')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Live activity" description="Derived from real run events" className="lg:col-span-2">
          {events.length === 0 ? (
            <div className="p-4">
              <EmptyState compact title="No activity yet" description="Events appear here the moment a run starts." />
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {events.map((event) => (
                <li key={event.id} className="flex gap-3 px-4 py-2">
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full bg-current ${toneTextClass(toneFor(event.level === 'error' ? 'failed' : event.level === 'success' ? 'completed' : event.level === 'warning' ? 'paused' : 'running'))}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-ink-1">{event.summary}</p>
                    <p className="text-[10.5px] text-ink-4">
                      <span className="font-mono">{event.type}</span> · {event.actor} ·{' '}
                      {projectById.get(event.projectId)?.name} · {timeAgo(event.createdAt.toISOString())}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Recent deliverables" description="Artifacts produced by runs">
            {artifacts.length === 0 ? (
              <div className="p-4">
                <EmptyState compact title="No artifacts yet" description="Finished outputs are stored here with their run." />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {artifacts.map((artifact) => (
                  <li key={artifact.id} className="px-4 py-2">
                    <p className="truncate text-[12.5px] text-ink-1">{artifact.name}</p>
                    <p className="text-[10.5px] text-ink-4">
                      {artifact.type} · v{artifact.version} · {timeAgo(artifact.createdAt.toISOString())}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent failures" description="Runs that did not pass verification">
            {failures.length === 0 ? (
              <div className="p-4">
                <EmptyState compact title="No recent failures" />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {failures.map((run) => (
                  <li key={run.id} className="px-4 py-2">
                    <Link href={`/projects/${run.projectId}/runs/${run.id}`} className="block">
                      <p className="truncate text-[12.5px] text-ink-1">{run.title}</p>
                      <p className="truncate text-[10.5px] text-danger">{run.error ?? 'No error recorded'}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Model providers" description="Health as last checked">
            <ul className="divide-y divide-line">
              {providers.map((provider) => (
                <li key={provider.id} className="flex items-center gap-2 px-4 py-2">
                  <Badge tone={toneFor(provider.healthStatus)} dot={provider.healthStatus === 'online'}>
                    {provider.healthStatus}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-1">{provider.name}</span>
                  {provider.isLocal ? <span className="text-[10px] text-ink-4">local</span> : null}
                </li>
              ))}
            </ul>
          </Card>

          {completed.length > 0 ? (
            <Card title="Recently completed">
              <ul className="divide-y divide-line">
                {completed.map((run) => (
                  <li key={run.id} className="px-4 py-2">
                    <Link href={`/projects/${run.projectId}/runs/${run.id}`} className="block">
                      <p className="truncate text-[12.5px] text-ink-1">{run.title}</p>
                      <p className="text-[10.5px] text-ink-4">
                        {projectById.get(run.projectId)?.name} · {timeAgo(run.finishedAt?.toISOString())}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
