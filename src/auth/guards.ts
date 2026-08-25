import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { forbidden, projectIsolationViolation, unauthorized } from '@/lib/errors';
import { getCurrentUser, publicUser, type PublicUser } from './session';
import type { Project } from '@/db/schema';

/**
 * Server-side authorization (§41, §8).
 *
 * Nothing in the UI is trusted: every route handler and server component calls
 * these guards. Project isolation is enforced here, in one place, so a handler
 * cannot forget it — a project lookup that does not belong to the caller's
 * organisation throws before any data is read.
 */

export async function requireUser(): Promise<PublicUser & { organizationId: string }> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  return publicUser(user);
}

/**
 * Load a project and verify the caller may see it.
 *
 * The organisation check is the hard boundary. Membership is recorded and
 * enforced for non-owner roles once multi-user is enabled; in V1 the owner
 * organisation is the tenant boundary.
 */
export async function requireProject(projectId: string): Promise<Project> {
  const user = await requireUser();
  return requireProjectForOrg(projectId, user.organizationId);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireProjectForOrg(projectId: string, organizationId: string): Promise<Project> {
  // Reject malformed identifiers before they reach Postgres. Without this, a
  // non-uuid value fails the column cast and surfaces as a 500 instead of the
  // 403 this guard is supposed to return.
  if (!UUID_RE.test(projectId) || !UUID_RE.test(organizationId)) {
    throw projectIsolationViolation(organizationId, `project ${projectId}`);
  }

  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.organizationId, organizationId)))
    .limit(1);
  const project = rows[0];
  if (!project) throw projectIsolationViolation(organizationId, `project ${projectId}`);
  return project;
}

/**
 * Verify that an arbitrary entity belongs to a project. Used by every nested
 * resource route so a client cannot read run A by asking for it under project B.
 */
export async function requireEntityInProject(
  projectId: string,
  entity: { projectId: string | null } | undefined,
  label: string,
): Promise<void> {
  if (!entity) throw forbidden(`${label} not found`);
  if (entity.projectId !== projectId) throw projectIsolationViolation(projectId, label);
}

export function isOwner(user: PublicUser): boolean {
  return user.role === 'owner' || user.role === 'admin';
}

/** Used by audit logging to attribute an action. */
export async function currentActorId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

export async function requireAdmin(): Promise<PublicUser> {
  const user = await requireUser();
  if (!isOwner(user)) throw forbidden('Administrator role required');
  return user;
}

export const guards = { requireUser, requireProject, requireEntityInProject, requireAdmin };
export type { PublicUser };
