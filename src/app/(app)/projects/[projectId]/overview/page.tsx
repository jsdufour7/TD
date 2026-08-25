import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { notFound } from 'next/navigation';
import { Badge, Card, EmptyState, Stat } from '@/components/ui/primitives';
import { timeAgo, toneFor, formatTokens, formatCost } from '@/lib/ui';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview' };

export default async function OverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  let project;
  try {
    project = await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const [runs, tasks, memories, instructions, repository, artifacts, usage, deployments] = await Promise.all([
    db.select().from(schema.agentRuns).where(eq(schema.agentRuns.projectId, projectId)).orderBy(desc(schema.agentRuns.createdAt)),
    db.select().from(schema.tasks).where(eq(schema.tasks.projectId, projectId)),
    db.select().from(schema.memories).where(eq(schema.memories.projectId, projectId)),
    db.select().from(schema.projectInstructions).where(eq(schema.projectInstructions.projectId, projectId)),
    db.select().from(schema.repositories).where(eq(schema.repositories.projectId, projectId)).limit(1),
    db.select().from(schema.artifacts).where(eq(schema.artifacts.projectId, projectId)).orderBy(desc(schema.artifacts.createdAt)).limit(10),
    db
      .select({
        calls: sql<number>`count(*)::int`,
        input: sql<number>`COALESCE(SUM(${schema.modelUsages.inputTokens}), 0)::int`,
        output: sql<number>`COALESCE(SUM(${schema.modelUsages.outputTokens}), 0)::int`,
        cost: sql<string>`COALESCE(SUM(${schema.modelUsages.costUsd}::numeric), 0)::text`,
      })
      .from(schema.modelUsages)
      .where(eq(schema.modelUsages.projectId, projectId)),
    db.select().from(schema.deployments).where(eq(schema.deployments.projectId, projectId)).orderBy(desc(schema.deployments.createdAt)).limit(5),
  ]);

  const stack = project.techStack as {
    languages?: Record<string, number>;
    frameworks?: string[];
    packageManager?: string | null;
    testFrameworks?: string[];
    conventions?: string[];
  } | null;

  const inspection = repository[0]?.inspection as
    | { warnings?: string[]; scripts?: Record<string, string>; git?: { dirty?: boolean; recentCommits?: Array<{ sha: string; message: string; author: string }> } }
    | null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Runs" value={runs.length} />
        <Stat label="Completed" value={runs.filter((r) => r.status === 'completed').length} tone="ok" />
        <Stat label="Open tasks" value={tasks.filter((t) => !['completed', 'cancelled', 'failed'].includes(t.status)).length} />
        <Stat label="Memories" value={memories.length} />
        <Stat
          label="Model cost"
          value={formatCost(usage[0]?.cost)}
          hint={`${formatTokens((usage[0]?.input ?? 0) + (usage[0]?.output ?? 0))} tokens · ${usage[0]?.calls ?? 0} calls`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Business context">
          <div className="space-y-3 p-4">
            {project.businessPurpose ? (
              <div>
                <p className="text-[11px] tracking-wide text-ink-4 uppercase">Purpose</p>
                <p className="mt-1 text-[13px] text-ink-1">{project.businessPurpose}</p>
              </div>
            ) : null}
            {project.description ? (
              <div>
                <p className="text-[11px] tracking-wide text-ink-4 uppercase">Description</p>
                <p className="mt-1 text-[13px] text-ink-2">{project.description}</p>
              </div>
            ) : null}
            {!project.businessPurpose && !project.description ? (
              <EmptyState compact title="No business context recorded" description="Add it in Settings so agents can judge scope." />
            ) : null}
          </div>
        </Card>

        <Card title="Detected stack" description="From the last repository inspection">
          {stack ? (
            <div className="space-y-3 p-4">
              {stack.frameworks?.length ? (
                <div className="flex flex-wrap gap-1">
                  {stack.frameworks.map((f) => (
                    <span key={f} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">
                      {f}
                    </span>
                  ))}
                </div>
              ) : null}
              {stack.languages ? (
                <div>
                  <p className="text-[11px] text-ink-4">Languages</p>
                  <p className="font-mono text-[11.5px] text-ink-2">
                    {Object.entries(stack.languages)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([name, count]) => `${name} (${count})`)
                      .join(', ')}
                  </p>
                </div>
              ) : null}
              {stack.packageManager ? (
                <p className="font-mono text-[11.5px] text-ink-3">package manager: {stack.packageManager}</p>
              ) : null}
              {stack.conventions?.length ? (
                <p className="text-[11.5px] text-ink-3">{stack.conventions.join(' · ')}</p>
              ) : null}
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                compact
                title="Repository not inspected"
                description="Connect a repository and AI Core will detect the framework, languages, test setup and conventions."
              />
            </div>
          )}
        </Card>

        <Card title="Project instructions" description="Injected into every agent prompt">
          {instructions.length === 0 ? (
            <div className="p-4">
              <EmptyState compact title="No instructions yet" description="Add product and technical instructions in Settings." />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {instructions.map((instruction) => (
                <li key={instruction.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Badge tone="info">{instruction.kind}</Badge>
                    <p className="text-[12.5px] text-ink-1">{instruction.title}</p>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-ink-3">{instruction.content}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Repository" description="Connection state and recent history">
          {repository[0] ? (
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={toneFor(repository[0].connectionStatus)}>{repository[0].connectionStatus}</Badge>
                <span className="font-mono text-[11.5px] text-ink-2">{repository[0].name}</span>
                <span className="font-mono text-[11px] text-ink-4">
                  @ {repository[0].currentBranch ?? repository[0].defaultBranch}
                </span>
              </div>
              <p className="font-mono text-[11px] text-ink-4">
                {repository[0].remoteUrl ?? 'local working copy'} ·{' '}
                {repository[0].inspectedAt ? `inspected ${timeAgo(repository[0].inspectedAt.toISOString())}` : 'never inspected'}
              </p>
              {repository[0].allowPush ? (
                <p className="text-[11px] text-ok">Push is permitted for this repository.</p>
              ) : (
                <p className="text-[11px] text-ink-4">
                  Push is disabled. AI Core will commit locally and request approval before any remote action.
                </p>
              )}
              {inspection?.git?.recentCommits?.length ? (
                <ul className="space-y-1 border-t border-line pt-2">
                  {inspection.git.recentCommits.slice(0, 4).map((commit) => (
                    <li key={commit.sha} className="flex gap-2 font-mono text-[10.5px]">
                      <span className="text-accent">{commit.sha.slice(0, 7)}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-3">{commit.message}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {inspection?.warnings?.length ? (
                <ul className="space-y-1 border-t border-line pt-2">
                  {inspection.warnings.map((warning) => (
                    <li key={warning} className="text-[11px] text-warn">
                      ⚠ {warning}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="p-4">
              <EmptyState compact title="No repository connected" />
            </div>
          )}
        </Card>

        <Card title="Artifacts" description="Deliverables produced by runs">
          {artifacts.length === 0 ? (
            <div className="p-4">
              <EmptyState compact title="No artifacts yet" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {artifacts.map((artifact) => (
                <li key={artifact.id} className="flex items-center gap-2 px-4 py-2">
                  <Badge tone="info">{artifact.type}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-1">{artifact.name}</span>
                  <span className="font-mono text-[10px] text-ink-4">v{artifact.version}</span>
                  <span className="text-[10.5px] text-ink-4">{timeAgo(artifact.createdAt.toISOString())}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Deployments">
          {deployments.length === 0 ? (
            <div className="p-4">
              <EmptyState
                compact
                title="No deployments"
                description="Deployment adapters are not implemented in V1. See IMPLEMENTATION_STATUS.md."
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {deployments.map((deployment) => (
                <li key={deployment.id} className="flex items-center gap-2 px-4 py-2">
                  <Badge tone={toneFor(deployment.status)}>{deployment.status}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">
                    {deployment.environmentKey} · {deployment.provider}
                  </span>
                  <span className="text-[10.5px] text-ink-4">{timeAgo(deployment.createdAt.toISOString())}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
