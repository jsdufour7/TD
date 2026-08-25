import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { requireAdmin } from '@/auth/guards';
import { jsonError, jsonOk, parseBody } from '@/lib/api';
import { hashPassword } from '@/auth/password';
import { recordAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';

/**
 * Admin Master — user management (§7 identity & tenancy).
 *
 * Scoped to the caller's organisation: an admin can only see and modify users of
 * their own organisation. Every mutation is audited. This is the interface the
 * data model always supported but that was not yet exposed.
 */

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
  password: z.string().min(8).max(200),
});

export async function GET(): Promise<Response> {
  try {
    const admin = await requireAdmin();
    const db = await getDb();

    const users = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        isActive: schema.users.isActive,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.organizationId, admin.organizationId))
      .orderBy(asc(schema.users.createdAt));

    return jsonOk({ users: users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const admin = await requireAdmin();
    const body = await parseBody(request, createSchema);
    const db = await getDb();

    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, body.email.toLowerCase().trim()))
      .limit(1);
    if (existing[0]) throw new AppError('conflict', 'A user with this email already exists');

    // Only an owner may create other owners or admins.
    if ((body.role === 'owner' || body.role === 'admin') && admin.role !== 'owner') {
      throw new AppError('forbidden', 'Only an owner can create owners or admins');
    }

    const [user] = await db
      .insert(schema.users)
      .values({
        organizationId: admin.organizationId,
        email: body.email.toLowerCase().trim(),
        name: body.name,
        role: body.role,
        passwordHash: hashPassword(body.password),
      })
      .returning();

    await recordAudit({
      action: 'admin.user.create',
      organizationId: admin.organizationId,
      userId: admin.id,
      entityType: 'user',
      entityId: user!.id,
      metadata: { email: user!.email, role: user!.role },
    });

    return jsonOk({ user: { id: user!.id, email: user!.email, name: user!.name, role: user!.role } }, 201);
  } catch (error) {
    return jsonError(error);
  }
}
