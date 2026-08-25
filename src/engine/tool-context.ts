import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { emitAndNotify } from './events';
import type { ToolContext } from '@/tools/types';
import type { RunEventType, EventLevel } from './events';

/**
 * Builds the ToolContext handed to every tool invocation.
 *
 * This is where cross-cutting behaviour is attached once rather than repeated in
 * each tool: event emission, file-change recording, approval blocking and
 * cancellation checks.
 */

const APPROVAL_POLL_MS = 1000;
const APPROVAL_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour before an approval expires

export type ToolContextInput = {
  projectId: string;
  runId: string | null;
  agentInstanceId: string | null;
  taskId?: string | null;
  sandboxRoot: string;
  permissions: Set<string>;
  isCancelled: () => boolean;
};

export async function buildToolContext(input: ToolContextInput): Promise<ToolContext> {
  const db = await getDb();

  return {
    projectId: input.projectId,
    runId: input.runId,
    agentInstanceId: input.agentInstanceId,
    taskId: input.taskId ?? null,
    sandboxRoot: input.sandboxRoot,
    permissions: input.permissions,
    isCancelled: input.isCancelled,

    emit: async ({ type, summary, level, actor, taskId, payload }) => {
      if (!input.runId) return;
      await emitAndNotify({
        runId: input.runId,
        projectId: input.projectId,
        type: type as RunEventType,
        summary,
        level: (level ?? 'info') as EventLevel,
        actor: actor ?? 'system',
        agentInstanceId: input.agentInstanceId,
        taskId: taskId ?? input.taskId ?? null,
        payload,
      });
    },

    recordFileChange: async ({ changeType, path, beforeContent, afterContent }) => {
      const additions = countLines(afterContent) - countLines(beforeContent);
      await db.insert(schema.gitChanges).values({
        projectId: input.projectId,
        runId: input.runId,
        agentInstanceId: input.agentInstanceId,
        taskId: input.taskId ?? null,
        changeType,
        path,
        additions: Math.max(0, countAdded(beforeContent, afterContent)),
        deletions: Math.max(0, -additions),
        beforeContent,
        afterContent,
      });

      if (input.runId) {
        await emitAndNotify({
          runId: input.runId,
          projectId: input.projectId,
          type: 'file.changed',
          actor: 'file-tools',
          agentInstanceId: input.agentInstanceId,
          taskId: input.taskId ?? null,
          summary: `${changeType === 'added' ? 'Created' : changeType === 'deleted' ? 'Deleted' : 'Modified'} ${path}`,
          payload: { changeType, path },
        });
      }
    },

    requestApproval: async ({ category, title, description, risk, action, environmentKey }) => {
      const [request] = await db
        .insert(schema.approvalRequests)
        .values({
          projectId: input.projectId,
          runId: input.runId,
          taskId: input.taskId ?? null,
          category,
          title,
          description,
          risk,
          action,
          ...(environmentKey ? { environmentKey } : {}),
          status: 'pending',
        })
        .returning();

      // Park the run so the UI and the worker agree that it is waiting.
      if (input.runId) {
        await db
          .update(schema.agentRuns)
          .set({ status: 'waiting_for_approval', updatedAt: new Date() })
          .where(eq(schema.agentRuns.id, input.runId));

        await emitAndNotify({
          runId: input.runId,
          projectId: input.projectId,
          type: 'approval.requested',
          level: 'warning',
          actor: 'approval',
          agentInstanceId: input.agentInstanceId,
          taskId: input.taskId ?? null,
          summary: `Approval required: ${title}`,
          payload: { approvalId: request!.id, category, risk },
        });
      }

      const startedAt = Date.now();
      while (Date.now() - startedAt < APPROVAL_TIMEOUT_MS) {
        if (input.isCancelled()) {
          await db
            .update(schema.approvalRequests)
            .set({ status: 'cancelled', decidedAt: new Date() })
            .where(eq(schema.approvalRequests.id, request!.id));
          return { status: 'rejected', note: 'Run was cancelled while awaiting approval' };
        }

        const rows = await db
          .select()
          .from(schema.approvalRequests)
          .where(eq(schema.approvalRequests.id, request!.id))
          .limit(1);
        const current = rows[0];
        if (current && current.status !== 'pending') {
          // Restore the run to running so the worker continues.
          if (input.runId) {
            await db
              .update(schema.agentRuns)
              .set({ status: 'running', updatedAt: new Date() })
              .where(eq(schema.agentRuns.id, input.runId));
          }
          return {
            status: current.status === 'approved' ? 'approved' : current.status === 'edited' ? 'edited' : 'rejected',
            ...(current.decisionNote ? { note: current.decisionNote } : {}),
            ...(current.editedInstruction ? { editedInstruction: current.editedInstruction } : {}),
          };
        }

        await sleep(APPROVAL_POLL_MS);
      }

      await db
        .update(schema.approvalRequests)
        .set({ status: 'expired', decidedAt: new Date() })
        .where(eq(schema.approvalRequests.id, request!.id));
      return { status: 'rejected', note: 'Approval timed out after one hour' };
    },
  };
}

function countLines(text: string | null): number {
  return text === null ? 0 : text.split('\n').length;
}

/** Approximate added lines by comparing line sets — good enough for review UI. */
function countAdded(before: string | null, after: string | null): number {
  if (before === null) return after ? after.split('\n').length : 0;
  if (after === null) return -(before.split('\n').length);
  const beforeSet = new Set(before.split('\n'));
  return after.split('\n').filter((line) => !beforeSet.has(line)).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when a task's dependencies are all in a terminal state. */
export async function dependenciesSatisfied(taskId: string): Promise<boolean> {
  const db = await getDb();
  const deps = await db
    .select({ task: schema.tasks })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.dependsOnTaskId))
    .where(and(eq(schema.taskDependencies.taskId, taskId)));

  return deps.every(({ task }) =>
    ['completed', 'blocked', 'cancelled'].includes(task.status),
  );
}
