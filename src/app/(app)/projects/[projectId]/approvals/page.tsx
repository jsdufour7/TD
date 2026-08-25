import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject } from '@/auth/guards';
import { notFound } from 'next/navigation';
import { ApprovalQueue } from '@/components/work/approval-queue';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Approvals' };

export default async function ProjectApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ highlight?: string }>;
}) {
  const { projectId } = await params;
  const { highlight } = await searchParams;
  try {
    await requireProject(projectId);
  } catch {
    notFound();
  }

  const db = await getDb();
  const approvals = await db
    .select()
    .from(schema.approvalRequests)
    .where(eq(schema.approvalRequests.projectId, projectId))
    .orderBy(desc(schema.approvalRequests.requestedAt));

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Approvals</h1>
        <p className="text-[13px] text-ink-3">
          High-impact operations wait here. The run is parked until you decide.
        </p>
      </div>
      <ApprovalQueue
        projectId={projectId}
        highlight={highlight ?? null}
        approvals={approvals.map((a) => ({
          id: a.id,
          projectId: a.projectId,
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
