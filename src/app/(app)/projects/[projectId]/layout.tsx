import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { ProjectTabs } from '@/components/layout/project-tabs';

export const dynamic = 'force-dynamic';

/**
 * Project workspace shell (§8, §26).
 *
 * The project is loaded through requireProject, which enforces organisation
 * isolation server-side. A project id belonging to another organisation 403s
 * before any of its data is read.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  let project;
  try {
    project = await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const [repository, activeRuns, pendingApprovals] = await Promise.all([
    db.select().from(schema.repositories).where(eq(schema.repositories.projectId, projectId)).limit(1),
    db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.projectId, projectId),
          eq(schema.agentRuns.status, 'running'),
        ),
      ),
    db
      .select({ id: schema.approvalRequests.id })
      .from(schema.approvalRequests)
      .where(and(eq(schema.approvalRequests.projectId, projectId), eq(schema.approvalRequests.status, 'pending'))),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface-1/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-tight text-ink-1">{project.name}</h1>
              {activeRuns.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded border border-accent/25 bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-accent uppercase">
                  <span className="size-1.5 rounded-full bg-accent animate-pulse-dot" />
                  running
                </span>
              ) : null}
              {pendingApprovals.length > 0 ? (
                <Link
                  href={`/projects/${projectId}/approvals`}
                  className="rounded border border-warn/25 bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-warn uppercase"
                >
                  {pendingApprovals.length} approval{pendingApprovals.length > 1 ? 's' : ''}
                </Link>
              ) : null}
              {project.isDemoData ? (
                <span className="rounded border border-warn/25 bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-warn uppercase">
                  demo data
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[11.5px] text-ink-3">
              {project.description ?? project.businessPurpose ?? 'No description'}
              {repository[0] ? (
                <span className="ml-2 font-mono text-ink-4">
                  · {repository[0].name} @ {repository[0].currentBranch ?? repository[0].defaultBranch}
                </span>
              ) : (
                <span className="ml-2 text-ink-4">· no repository connected</span>
              )}
            </p>
          </div>
        </div>
        <ProjectTabs projectId={projectId} />
      </header>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export { redirect };
