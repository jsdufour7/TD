import Link from 'next/link';
import { desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { toneFor, timeAgo, durationLabel, formatTokens, formatCost } from '@/lib/ui';
import { Activity } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Runs' };

/** Every run across every project, newest first. */
export default async function RunsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const db = await getDb();
  const projects = await db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, user.organizationId));
  const projectIds = projects.map((p) => p.id);
  const projectById = new Map(projects.map((p) => [p.id, p.name]));

  const runs =
    projectIds.length > 0
      ? await db
          .select()
          .from(schema.agentRuns)
          .where(inArray(schema.agentRuns.projectId, projectIds))
          .orderBy(desc(schema.agentRuns.createdAt))
          .limit(100)
      : [];

  const live = runs.filter((r) => ['running', 'queued', 'paused', 'waiting_for_approval'].includes(r.status)).length;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5 lg:p-7">
      <PageHeader
        icon={<Activity className="size-4" />}
        title="Runs"
        subtitle="Tous les runs autonomes, tous projets confondus. Les runs sont durables : ils survivent à un rafraîchissement et à un redémarrage."
      />

      {runs.length === 0 ? (
        <Card>
          <div className="p-6">
            <EmptyState
              title="No runs yet"
              description="Open a project and give AI Core an objective."
              action={
                <Link href="/projects" className="text-xs text-accent underline">
                  Go to projects
                </Link>
              }
            />
          </div>
        </Card>
      ) : (
        <Card title={`${runs.length} runs`} description={`${live} currently active`}>
          <ul className="divide-y divide-line">
            {runs.map((run) => {
              const isLive = ['running', 'queued', 'paused', 'waiting_for_approval'].includes(run.status);
              return (
                <li key={run.id}>
                  <Link
                    href={`/projects/${run.projectId}/runs/${run.id}`}
                    className="flex flex-wrap items-center gap-2 px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <Badge tone={toneFor(run.status)} dot={isLive}>
                      {run.status.replace(/_/g, ' ')}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink-1">{run.title}</p>
                      <p className="font-mono text-[10.5px] text-ink-4">
                        {projectById.get(run.projectId) ?? 'unknown'} · phase {run.phase} ·{' '}
                        {timeAgo(run.createdAt.toISOString())}
                      </p>
                    </div>
                    {run.startedAt && run.finishedAt ? (
                      <span className="font-mono text-[10.5px] text-ink-4">
                        {durationLabel(new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())}
                      </span>
                    ) : null}
                    <span className="font-mono text-[10.5px] text-ink-4">{formatTokens(run.inputTokens + run.outputTokens)}</span>
                    <span className="font-mono text-[10.5px] text-ink-3">{formatCost(run.costUsd)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
