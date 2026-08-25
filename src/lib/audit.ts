import { getDb, schema, type Tx } from '@/db/client';
import { redactSecrets } from './env';
import { createLogger } from './logger';

const log = createLogger('audit');

export type AuditInput = {
  action: string;
  organizationId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  entityType?: string;
  entityId?: string;
  outcome?: 'success' | 'failure' | 'denied';
  metadata?: Record<string, unknown>;
  ip?: string;
};

/**
 * Audit trail (§41). Writes are best-effort: a failure to record an audit event
 * must not break the operation, but it is logged loudly so the gap is visible.
 */
export async function recordAudit(input: AuditInput, tx?: Tx): Promise<void> {
  const payload = {
    action: input.action,
    organizationId: input.organizationId ?? null,
    projectId: input.projectId ?? null,
    userId: input.userId ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    outcome: input.outcome ?? 'success',
    metadata: input.metadata ? JSON.parse(redactSecrets(JSON.stringify(input.metadata))) : null,
    ip: input.ip ?? null,
  };

  try {
    if (tx) {
      await tx.insert(schema.auditEvents).values(payload);
      return;
    }
    const db = await getDb();
    await db.insert(schema.auditEvents).values(payload);
  } catch (error) {
    log.error('failed to record audit event', {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
