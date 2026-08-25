import { redirect } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { getCurrentUser, publicUser } from '@/auth/session';
import { Sidebar } from '@/components/layout/sidebar';
import { GlobalCoo } from '@/components/coo/global-coo';
import { getAssignmentsView } from '@/ai/assignments-view';

export const dynamic = 'force-dynamic';

/**
 * Authenticated shell.
 *
 * The sidebar is rendered from live database state: which projects exist, which
 * have a run in flight, how many approvals are waiting. Nothing here is static
 * or invented.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const db = await getDb();

  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, user.organizationId))
    .orderBy(desc(schema.projects.updatedAt))
    .limit(20);

  const projectIds = projects.map((p) => p.id);

  const [activeRuns, pendingApprovals, failedRuns, blockedTasks] = await Promise.all([
    projectIds.length > 0
      ? db
          .select({ projectId: schema.agentRuns.projectId })
          .from(schema.agentRuns)
          .where(
            and(
              inArray(schema.agentRuns.projectId, projectIds),
              inArray(schema.agentRuns.status, ['running', 'queued', 'paused', 'waiting_for_approval']),
            ),
          )
      : Promise.resolve([] as Array<{ projectId: string }>),
    projectIds.length > 0
      ? db
          .select({ id: schema.approvalRequests.id })
          .from(schema.approvalRequests)
          .where(
            and(
              inArray(schema.approvalRequests.projectId, projectIds),
              eq(schema.approvalRequests.status, 'pending'),
            ),
          )
      : Promise.resolve([] as Array<{ id: string }>),
    projectIds.length > 0
      ? db
          .select({ id: schema.agentRuns.id })
          .from(schema.agentRuns)
          .where(
            and(inArray(schema.agentRuns.projectId, projectIds), eq(schema.agentRuns.status, 'failed')),
          )
      : Promise.resolve([] as Array<{ id: string }>),
    projectIds.length > 0
      ? db
          .select({ id: schema.tasks.id })
          .from(schema.tasks)
          .where(and(inArray(schema.tasks.projectId, projectIds), eq(schema.tasks.status, 'blocked')))
      : Promise.resolve([] as Array<{ id: string }>),
  ]);

  // The COO's model assignment + gateway health, read once for the shell so the
  // drawer can tell the truth about which model will answer — before any click.
  const assignments = await getAssignmentsView(user.organizationId).catch(() => null);

  const activeProjectIds = new Set(activeRuns.map((r) => r.projectId));
  const attention = {
    approvals: pendingApprovals.length,
    failedRuns: failedRuns.length,
    blockedTasks: blockedTasks.length,
  };

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        user={publicUser(user)}
        projects={projects.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          hasActiveRun: activeProjectIds.has(p.id),
        }))}
        pendingApprovals={pendingApprovals.length}
        activeRuns={activeProjectIds.size}
        failedRuns={failedRuns.length}
        blockedTasks={blockedTasks.length}
      />
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
      <GlobalCoo
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        attention={attention}
        assignments={assignments}
      />
    </div>
  );
}
