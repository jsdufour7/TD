import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { notFound } from 'next/navigation';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { toneFor, timeAgo, durationLabel, formatTokens, formatCost } from '@/lib/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Runs' };

export default async function RunsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  try {
    await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const runs = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.projectId, projectId))
    .orderBy(desc(schema.agentRuns.createdAt));

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Runs</h1>
        <p className="text-[13px] text-ink-3">
          {runs.length} run(s). A run is durable: it survives a browser refresh and a server restart.
        </p>
      </div>

      {runs.length === 0 ? (
        <Card>
          <div className="p-6">
            <EmptyState
              title="No runs yet"
              description="Start an autonomous run from the Work surface."
              action={
                <Link href={`/projects/${projectId}/work`} className="text-xs text-accent underline">
                  Go to the work surface
                </Link>
              }
            />
          </div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {runs.map((run) => {
              const isLive = ['running', 'queued', 'paused', 'waiting_for_approval'].includes(run.status);
              return (
                <li key={run.id}>
                  <Link
                    href={`/projects/${projectId}/runs/${run.id}`}
                    className="flex flex-wrap items-center gap-2 px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <Badge tone={toneFor(run.status)} dot={isLive}>
                      {run.status.replace(/_/g, ' ')}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink-1">{run.title}</p>
                      <p className="font-mono text-[10.5px] text-ink-4">
                        phase {run.phase} · policy {run.routingPolicy} · {timeAgo(run.createdAt.toISOString())}
                      </p>
                    </div>
                    {run.startedAt && run.finishedAt ? (
                      <span className="font-mono text-[10.5px] text-ink-4">
                        {durationLabel(new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())}
                      </span>
                    ) : null}
                    <span className="font-mono text-[10.5px] text-ink-4">
                      {formatTokens(run.inputTokens + run.outputTokens)}
                    </span>
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
