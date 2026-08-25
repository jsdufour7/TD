import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireAdmin } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { AppError, notFound } from '@/lib/errors';

/**
 * Update a user's email, name, role, or active state. Organisation-scoped and
 * audited.
 *
 * Guard rails:
 *  - You cannot demote or deactivate the last active owner of the organisation.
 *  - You cannot modify a user outside your own organisation (they simply do not
 *    exist from your point of view).
 *  - Only an owner may grant or revoke the owner/admin role.
 */

const updateSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['owner', 'admin', 'member']).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const admin = await requireAdmin();
    const body = await parseBody(request, updateSchema);
    const db = await getDb();

    const rows = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, id), eq(schema.users.organizationId, admin.organizationId)))
      .limit(1);
    const user = rows[0];
    if (!user) throw notFound('User not found');

    const roleChanges = body.role !== undefined && body.role !== user.role;
    if (roleChanges && (body.role === 'owner' || body.role === 'admin' || user.role === 'owner') && admin.role !== 'owner') {
      throw new AppError('forbidden', 'Only an owner can change the owner/admin role');
    }

    const deactivating = body.isActive === false && user.isActive;
    const demotingOwner = user.role === 'owner' && (body.role === 'admin' || body.role === 'member');

    if (user.role === 'owner' && (deactivating || demotingOwner)) {
      const owners = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.organizationId, admin.organizationId),
            eq(schema.users.role, 'owner'),
            eq(schema.users.isActive, true),
          ),
        );
      if (owners.length <= 1) {
        throw new AppError('conflict', 'Cannot remove or deactivate the last active owner of the organisation');
      }
    }

    if (body.email) {
      const clash = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, body.email.toLowerCase().trim()))
        .limit(1);
      if (clash[0] && clash[0].id !== user.id) {
        throw new AppError('conflict', 'Another user already has this email');
      }
    }

    const [updated] = await db
      .update(schema.users)
      .set({
        ...(body.email !== undefined ? { email: body.email.toLowerCase().trim() } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      })
      .where(eq(schema.users.id, user.id))
      .returning();

    await recordAudit({
      action: 'admin.user.update',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'user',
      entityId: user.id,
      metadata: {
        email: body.email ?? null,
        name: body.name ?? null,
        role: body.role ?? null,
        isActive: body.isActive ?? null,
      },
    });

    return jsonOk({
      user: {
        id: updated!.id,
        email: updated!.email,
        name: updated!.name,
        role: updated!.role,
        isActive: updated!.isActive,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
