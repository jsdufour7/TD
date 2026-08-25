import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireAdmin } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { hashPassword } from '@/auth/password';
import { recordAudit } from '@/lib/audit';
import { notFound } from '@/lib/errors';

/**
 * Admin-set a user's password (account recovery). Organisation-scoped, audited.
 *
 * The new password is hashed with scrypt; the plaintext is never stored or
 * logged. In a production identity stack this would be a reset-email flow —
 * here the admin sets it directly, which matches the "Admin Master" request.
 */

const passwordSchema = z.object({
  password: z.string().min(8).max(200),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const admin = await requireAdmin();
    const body = await parseBody(request, passwordSchema);
    const db = await getDb();

    const rows = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, id), eq(schema.users.organizationId, admin.organizationId)))
      .limit(1);
    const user = rows[0];
    if (!user) throw notFound('User not found');

    await db
      .update(schema.users)
      .set({ passwordHash: hashPassword(body.password) })
      .where(eq(schema.users.id, user.id));

    await recordAudit({
      action: 'admin.user.password_reset',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'user',
      entityId: user.id,
      metadata: { targetEmail: user.email },
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
