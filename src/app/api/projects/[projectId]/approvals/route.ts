import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireProject, requireUser } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { emitAndNotify } from '@/engine/events';
import { recordAudit } from '@/lib/audit';

const decisionSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(['approve', 'reject', 'edit']),
  note: z.string().max(2000).optional(),
  editedInstruction: z.string().max(4000).optional(),
});

/** Pending approvals for a project. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const db = await getDb();

    const approvals = await db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.projectId, projectId))
      .orderBy(desc(schema.approvalRequests.requestedAt));

    return jsonOk({ approvals: approvals.map(serialiseApproval) });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Approve, reject or edit a requested action (§20).
 *
 * The decision is written to the database; the blocked tool polls this row and
 * resumes or aborts accordingly. The run's own status is updated here too, so the
 * UI and the engine can never disagree about whether work is waiting.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    await requireProject(projectId);
    const user = await requireUser();
    const body = await parseBody(request, decisionSchema);
    const db = await getDb();

    const rows = await db
      .select()
      .from(schema.approvalRequests)
      .where(and(eq(schema.approvalRequests.id, body.approvalId), eq(schema.approvalRequests.projectId, projectId)))
      .limit(1);
    const approval = rows[0];
    if (!approval) return jsonError(new Error('Approval request not found in this project'));
    if (approval.status !== 'pending') {
      return jsonError(new Error(`This request was already ${approval.status}`));
    }

    const status = body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : 'edited';

    await db
      .update(schema.approvalRequests)
      .set({
        status,
        decidedByUserId: user.id,
        ...(body.note ? { decisionNote: body.note } : {}),
        ...(body.editedInstruction ? { editedInstruction: body.editedInstruction } : {}),
        decidedAt: new Date(),
      })
      .where(eq(schema.approvalRequests.id, approval.id));

    if (approval.runId) {
      await db
        .update(schema.agentRuns)
        .set({ status: status === 'rejected' ? 'running' : 'running', updatedAt: new Date() })
        .where(eq(schema.agentRuns.id, approval.runId));

      await emitAndNotify({
        runId: approval.runId,
        projectId,
        type: status === 'approved' ? 'approval.granted' : 'approval.denied',
        level: status === 'approved' ? 'success' : 'warning',
        actor: 'user',
        summary: `${status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Edited'}: ${approval.title}`,
        payload: { approvalId: approval.id, decision: status, note: body.note ?? null },
      });
    }

    await recordAudit({
      action: `approval.${status}`,
      projectId,
      userId: user.id,
      entityType: 'approval_request',
      entityId: approval.id,
      metadata: { category: approval.category, risk: approval.risk, note: body.note ?? null },
    });

    return jsonOk({ ok: true, status });
  } catch (error) {
    return jsonError(error);
  }
}

export function serialiseApproval(approval: typeof schema.approvalRequests.$inferSelect) {
  return {
    id: approval.id,
    projectId: approval.projectId,
    runId: approval.runId,
    taskId: approval.taskId,
    category: approval.category,
    title: approval.title,
    description: approval.description,
    risk: approval.risk,
    environmentKey: approval.environmentKey,
    action: approval.action,
    status: approval.status,
    requestedByAgentKey: approval.requestedByAgentKey,
    decisionNote: approval.decisionNote,
    editedInstruction: approval.editedInstruction,
    requestedAt: approval.requestedAt.toISOString(),
    decidedAt: approval.decidedAt?.toISOString() ?? null,
  };
}
