import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb, schema } from '@/db/client';
import { getCurrentUser } from '@/auth/session';
import { requireUser } from '@/auth/guards';
import { DrivingMode } from '@/components/coo/driving-mode';
import { Car } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mode Voiture' };

/**
 * Mode Voiture (Mains Libres). Boucle de dialogue vocale bidirectionnelle,
 * optimisée mobile/voiture, branchée sur le même thread COO persistant.
 */
export default async function DrivePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  await requireUser();
  const { project: projectIdParam } = await searchParams;
  const user = await getCurrentUser();
  const db = await getDb();

  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, user!.organizationId))
    .orderBy(desc(schema.projects.updatedAt));

  const projectId = projectIdParam ?? projects[0]?.id;
  if (!projectId) notFound();

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        icon={<Car className="size-4" />}
        title="Mode Voiture"
        subtitle="Mains libres : parlez, le COO répond à voix haute. « Stop » ou « Attends » coupe net et vous redonne la parole."
        action={
          <nav className="flex max-w-full flex-wrap gap-1" aria-label="Projets">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/drive?project=${p.id}`}
                className={
                  p.id === projectId
                    ? 'rounded border border-accent/40 bg-accent/15 px-2 py-1 text-[11px] text-accent'
                    : 'rounded border border-line px-2 py-1 text-[11px] text-ink-3 hover:text-ink-1'
                }
              >
                {p.name}
              </Link>
            ))}
          </nav>
        }
      />
      <DrivingMode projectId={projectId} />
    </div>
  );
}
