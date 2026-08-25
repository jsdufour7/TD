import { desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ApprovalQueue } from '@/components/work/approval-queue';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approbations' };

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { highlight } = await searchParams;

  const db = await getDb();
  const projects = await db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, user.organizationId));
  const projectIds = projects.map((p) => p.id);
  const projectById = new Map(projects.map((p) => [p.id, p.name]));

  const approvals =
    projectIds.length > 0
      ? await db
          .select()
          .from(schema.approvalRequests)
          .where(inArray(schema.approvalRequests.projectId, projectIds))
          .orderBy(desc(schema.approvalRequests.requestedAt))
      : [];

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5 lg:p-7">
      <PageHeader
        icon={<ShieldCheck className="size-4" />}
        title="Approbations"
        subtitle="Opérations à fort impact, tous projets confondus. Suppressions destructives, déploiements en production, git push, secrets et commandes dangereuses bloquent ici jusqu’à votre décision."
      />
      <ApprovalQueue
        highlight={highlight ?? null}
        approvals={approvals.map((a) => ({
          id: a.id,
          projectId: a.projectId,
          projectName: projectById.get(a.projectId),
          runId: a.runId,
          category: a.category,
          title: a.title,
          description: a.description,
          risk: a.risk,
          action: a.action,
          status: a.status,
          requestedAt: a.requestedAt.toISOString(),
        }))}
      />
    </div>
  );
}
