import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/session';
import { Users } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { UserAdmin } from '@/components/admin/user-admin';
import { getDb, schema } from '@/db/client';
import { eq, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Administration' };

/**
 * Admin Master.
 *
 * Only owners/admins reach this page; everyone else is redirected. The heavy
 * rules (organisation scope, last-owner protection, role-grant limits) live in
 * the API and are re-enforced there, so the UI cannot be the only control.
 */
export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'owner' && user.role !== 'admin') redirect('/home');

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
    .where(eq(schema.users.organizationId, user.organizationId))
    .orderBy(schema.users.createdAt);

  const owners = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.organizationId, user.organizationId),
        eq(schema.users.role, 'owner'),
        eq(schema.users.isActive, true),
      ),
    );

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-5 lg:p-7">
      <PageHeader
        icon={<Users className="size-4" />}
        title="Administration"
        subtitle="Gérez les utilisateurs de l'organisation : créer, modifier courriel / nom / rôle, activer ou désactiver, définir un mot de passe."
      />
      <UserAdmin
        selfId={user.id}
        isOwner={user.role === 'owner'}
        initialUsers={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
      />
      {owners.length === 1 ? (
        <p className="text-[11px] text-ink-4">
          Un seul propriétaire actif : le serveur refusera de le rétrograder ou de le désactiver.
        </p>
      ) : null}
    </div>
  );
}
