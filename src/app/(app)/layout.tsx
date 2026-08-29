import { redirect } from 'next/navigation';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { getCurrentUser, publicUser } from '@/auth/session';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { GlobalCoo } from '@/components/coo/global-coo';
import { getAssignmentsView } from '@/ai/assignments-view';

export const dynamic = 'force-dynamic';

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

  const projectIds = projects.map((project) => project.id);
  const [activeRuns, pendingApprovals, failedRuns, blockedTasks] = await Promise.all([
    projectIds.length
      ? db.select({ projectId: schema.agentRuns.projectId }).from(schema.agentRuns).where(
          and(
            inArray(schema.agentRuns.projectId, projectIds),
            inArray(schema.agentRuns.status, ['running', 'queued', 'paused', 'waiting_for_approval']),
          ),
        )
      : Promise.resolve([] as Array<{ projectId: string }>),
    projectIds.length
      ? db.select({ id: schema.approvalRequests.id }).from(schema.approvalRequests).where(
          and(inArray(schema.approvalRequests.projectId, projectIds), eq(schema.approvalRequests.status, 'pending')),
        )
      : Promise.resolve([] as Array<{ id: string }>),
    projectIds.length
      ? db.select({ id: schema.agentRuns.id }).from(schema.agentRuns).where(
          and(inArray(schema.agentRuns.projectId, projectIds), eq(schema.agentRuns.status, 'failed')),
        )
      : Promise.resolve([] as Array<{ id: string }>),
    projectIds.length
      ? db.select({ id: schema.tasks.id }).from(schema.tasks).where(
          and(inArray(schema.tasks.projectId, projectIds), eq(schema.tasks.status, 'blocked')),
        )
      : Promise.resolve([] as Array<{ id: string }>),
  ]);

  const assignments = await getAssignmentsView(user.organizationId).catch(() => null);
  const activeProjectIds = new Set(activeRuns.map((run) => run.projectId));
  const attention = {
    approvals: pendingApprovals.length,
    failedRuns: failedRuns.length,
    blockedTasks: blockedTasks.length,
  };
  const safeUser = publicUser(user);

  return (
    <div className="flex min-h-dvh bg-surface-0">
      <Sidebar
        user={safeUser}
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
          slug: project.slug,
          hasActiveRun: activeProjectIds.has(project.id),
        }))}
        pendingApprovals={pendingApprovals.length}
        activeRuns={activeProjectIds.size}
        failedRuns={failedRuns.length}
        blockedTasks={blockedTasks.length}
      />
      <div className="min-w-0 flex-1">
        <Topbar user={safeUser} />
        <main id="main" className="min-w-0 flex-1">{children}</main>
      </div>
      <GlobalCoo
        projects={projects.map((project) => ({ id: project.id, name: project.name }))}
        attention={attention}
        assignments={assignments}
      />
    </div>
  );
}
